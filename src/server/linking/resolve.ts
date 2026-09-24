import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { roster, memberLinks, memberEventCodes, auditLog, type Event } from '../db/schema.js';
import { findEnrolledByEmail, currentRosterIdForCard } from '../roster/query.js';
import type { MacUser } from '../auth/mac-auth.js';
import { getAttemptState, type AttemptState } from './attempts.js';

// The §7 resolution state machine, split into two concerns:
//   • linkState — is this account resolved to a roster row yet? (account-wide)
//   • eventOutcome — for a given event, what do we hand this person? (per-event)

export type LinkState =
  // `rosterId` is the row in the *current* snapshot (re-found via cardNumber),
  // so it stays valid across roster imports. `cardNumber` is the stable key and
  // is null only for a link made against a roster row that had no student ID.
  | { status: 'linked'; rosterId: number; cardNumber: string | null }
  // Show the student-ID field. `attempts` drives the "attempts remaining" copy.
  | { status: 'needs_student_id'; attempts: AttemptState }
  // Attempts exhausted this cooldown window → treated as not-a-member for now,
  // UI shows the quiet "think this is wrong? contact us" line (§7).
  | { status: 'locked' };

export type EventOutcome =
  // Linked and a code exists for this event → the auto-apply link (§8).
  | { state: 'code_ready'; autoApplyUrl: string }
  // Not linked (skipped / exhausted / genuinely not a member), or linked but no
  // code has gone out for this event → plain link. Events without codes are
  // deliberate (no member pricing), so there's nothing to wait for.
  | { state: 'not_member'; ticketUrl: string };

async function findLink(
  macUserId: string,
): Promise<{ rosterId: number; cardNumber: string | null } | null> {
  const [row] = await db
    .select({ rosterId: memberLinks.rosterId, cardNumber: memberLinks.cardNumber })
    .from(memberLinks)
    .where(eq(memberLinks.macUserId, macUserId));
  return row ?? null;
}

/**
 * Turn a stored link into the live `linked` state. The stored roster_id points at
 * the snapshot row from linking time, which a later roster import supersedes, so
 * re-find the current row by card number. If the card number is gone from the
 * current snapshot (left the club, or an export hiccup) we keep the stored id —
 * the link itself is never re-checked or torn down (§13), and with no code rows
 * for a stale row the outcome degrades to the plain ticket link on its own.
 */
async function toLinkedState(link: {
  rosterId: number;
  cardNumber: string | null;
}): Promise<LinkState> {
  if (!link.cardNumber) return { status: 'linked', rosterId: link.rosterId, cardNumber: null };
  const current = await currentRosterIdForCard(link.cardNumber);
  return {
    status: 'linked',
    rosterId: current ?? link.rosterId,
    cardNumber: link.cardNumber,
  };
}

/**
 * Resolve the account-wide link state for a logged-in user (§7 steps 1-3).
 *
 * 1. Existing link → fast path.
 * 2. No link → try automatic email match (ENROLLED only); auto-create on hit.
 * 3. Still nothing → surface the student-ID field, unless attempts are exhausted.
 *
 * Never re-matches on email once a link exists (§13) — step 1 short-circuits.
 */
export async function resolveLinkState(user: MacUser, now = new Date()): Promise<LinkState> {
  const existing = await findLink(user.macUserId);
  if (existing) return toLinkedState(existing);

  // Automatic email match — only the ~10% whose login email is their roster email.
  if (user.email) {
    const match = await findEnrolledByEmail(user.email);
    if (match) {
      const rosterId = await createLink(user.macUserId, match.id, 'email_auto');
      return { status: 'linked', rosterId, cardNumber: match.cardNumber };
    }
  }

  const attempts = await getAttemptState(user.macUserId, now);
  if (attempts.locked) return { status: 'locked' };
  return { status: 'needs_student_id', attempts };
}

/**
 * Create a member_link (idempotent on mac_user_id — a race that inserts twice
 * resolves to the first winner) and audit it. Returns the effective roster_id.
 */
export async function createLink(
  macUserId: string,
  rosterId: number,
  via: 'email_auto' | 'student_id' | 'manual_review',
): Promise<number> {
  // Snapshot the card number alongside the row id: the id is superseded by the
  // next roster import, the card number is what re-finds them after one.
  const [target] = await db
    .select({ cardNumber: roster.cardNumber })
    .from(roster)
    .where(eq(roster.id, rosterId));

  const inserted = await db
    .insert(memberLinks)
    .values({ macUserId, rosterId, cardNumber: target?.cardNumber ?? null, linkedVia: via })
    .onConflictDoNothing({ target: memberLinks.macUserId })
    .returning({ rosterId: memberLinks.rosterId });

  if (inserted[0]) {
    await db.insert(auditLog).values({
      actorMacUserId: macUserId,
      action: 'link_created',
      detail: { rosterId, linkedVia: via },
    });
    return inserted[0].rosterId;
  }

  // Lost the race / already linked — return the existing link's roster_id.
  const existing = await findLink(macUserId);
  return existing?.rosterId ?? rosterId;
}

export function composeAutoApplyUrl(humanitixEventUrl: string, code: string): string {
  // Link format is confirmed (§8): {event_url}?discountcode={code}.
  const sep = humanitixEventUrl.includes('?') ? '&' : '?';
  return `${humanitixEventUrl}${sep}discountcode=${encodeURIComponent(code)}`;
}

/**
 * Per-event outcome (§7 "Outcome"). Given the resolved link state and an event,
 * decide what to hand the visitor. Not-linked always yields the plain link — a
 * normal outcome, never an error (§13).
 */
export async function resolveEventOutcome(linkState: LinkState, event: Event): Promise<EventOutcome> {
  if (linkState.status !== 'linked') {
    return { state: 'not_member', ticketUrl: event.humanitixEventUrl };
  }

  // Match on card number across every import batch, not on the current row id:
  // a code provisioned before a roster import hangs off that older batch's row,
  // and it is still the code sitting in Humanitix's uploaded CSV. Prefer an
  // exported row when more than one batch has one (they carry the same code —
  // it is derived from card_number + event_id).
  const [code] = linkState.cardNumber
    ? await db
        .select({ code: memberEventCodes.code, exportedAt: memberEventCodes.exportedAt })
        .from(memberEventCodes)
        .innerJoin(roster, eq(roster.id, memberEventCodes.rosterId))
        .where(and(eq(roster.cardNumber, linkState.cardNumber), eq(memberEventCodes.eventId, event.id)))
        .orderBy(sql`${memberEventCodes.exportedAt} asc nulls last`)
        .limit(1)
    : await db
        .select({ code: memberEventCodes.code, exportedAt: memberEventCodes.exportedAt })
        .from(memberEventCodes)
        .where(and(eq(memberEventCodes.rosterId, linkState.rosterId), eq(memberEventCodes.eventId, event.id)));

  // Unexported codes were never handed to an officer to upload, so a discount
  // link would fail at checkout — send them to the normal tickets instead.
  if (!code || !code.exportedAt) return { state: 'not_member', ticketUrl: event.humanitixEventUrl };
  return { state: 'code_ready', autoApplyUrl: composeAutoApplyUrl(event.humanitixEventUrl, code.code) };
}
