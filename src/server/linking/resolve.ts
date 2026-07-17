import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { memberLinks, memberEventCodes, auditLog, type Event } from '../db/schema.js';
import { findEnrolledByEmail } from '../roster/query.js';
import type { MacUser } from '../auth/mac-auth.js';
import { getAttemptState, type AttemptState } from './attempts.js';

// The §7 resolution state machine, split into two concerns:
//   • linkState — is this account resolved to a roster row yet? (account-wide)
//   • eventOutcome — for a given event, what do we hand this person? (per-event)

export type LinkState =
  | { status: 'linked'; rosterId: number }
  // Show the student-ID field. `attempts` drives the "attempts remaining" copy.
  | { status: 'needs_student_id'; attempts: AttemptState }
  // Attempts exhausted this cooldown window → treated as not-a-member for now,
  // UI shows the quiet "think this is wrong? contact us" line (§7).
  | { status: 'locked' };

export type EventOutcome =
  // Linked and a code exists for this event → the auto-apply link (§8).
  | { state: 'code_ready'; autoApplyUrl: string }
  // Linked but no code provisioned for this event yet → "being set up" (§7).
  | { state: 'pending' }
  // Not linked (skipped / exhausted / genuinely not a member) → plain link.
  | { state: 'not_member'; ticketUrl: string };

async function findLink(macUserId: string): Promise<{ rosterId: number } | null> {
  const [row] = await db
    .select({ rosterId: memberLinks.rosterId })
    .from(memberLinks)
    .where(eq(memberLinks.macUserId, macUserId));
  return row ?? null;
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
  if (existing) return { status: 'linked', rosterId: existing.rosterId };

  // Automatic email match — only the ~10% whose login email is their roster email.
  if (user.email) {
    const match = await findEnrolledByEmail(user.email);
    if (match) {
      const rosterId = await createLink(user.macUserId, match.id, 'email_auto');
      return { status: 'linked', rosterId };
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
  const inserted = await db
    .insert(memberLinks)
    .values({ macUserId, rosterId, linkedVia: via })
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

  const [code] = await db
    .select({ code: memberEventCodes.code })
    .from(memberEventCodes)
    .where(and(eq(memberEventCodes.rosterId, linkState.rosterId), eq(memberEventCodes.eventId, event.id)));

  if (!code) return { state: 'pending' };
  return { state: 'code_ready', autoApplyUrl: composeAutoApplyUrl(event.humanitixEventUrl, code.code) };
}
