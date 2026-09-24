import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';
import { describeDb, resetDb } from '../../test/db.js';
import { db } from '../db/index.js';
import { events, memberLinks, roster, type Event } from '../db/schema.js';
import { provisionEventCodes, buildEventCsv, markExported } from '../codes/provision.js';
import { generateCode } from '../codes/generate.js';
import { createLink, resolveLinkState, resolveEventOutcome } from './resolve.js';
import type { MacUser } from '../auth/mac-auth.js';

const CARD = '31234567';

/** Import a roster snapshot the way importRoster does — a fresh batch of rows. */
async function importBatch(
  rows: Array<{ cardNumber: string | null; email?: string; enrolled?: boolean }>,
): Promise<void> {
  const importBatchId = randomUUID();
  await db.insert(roster).values(
    rows.map((r) => ({
      cardNumber: r.cardNumber,
      email: r.email ?? null,
      enrollmentStatus: (r.enrolled === false ? 'INACTIVE' : 'ENROLLED') as 'ENROLLED' | 'INACTIVE',
      importBatchId,
    })),
  );
}

async function createEvent(slug = 'hackathon'): Promise<Event> {
  const [event] = await db
    .insert(events)
    .values({ name: slug, slug, humanitixEventUrl: `https://events.humanitix.com/${slug}` })
    .returning();
  if (!event) throw new Error('event insert returned nothing');
  return event;
}

const user = (id = 'mac-user-1', email?: string): MacUser =>
  ({ macUserId: id, email: email ?? null }) as MacUser;

/** Provision, then export — i.e. an officer downloaded the CSV and uploaded it. */
async function provisionAndExport(eventId: number): Promise<void> {
  await provisionEventCodes(eventId);
  const { unexportedIds } = await buildEventCsv(eventId);
  await markExported(unexportedIds);
}

async function linkedRosterId(macUserId: string): Promise<number> {
  const [row] = await db
    .select({ rosterId: memberLinks.rosterId })
    .from(memberLinks)
    .where(eq(memberLinks.macUserId, macUserId));
  if (!row) throw new Error(`no member_link for ${macUserId}`);
  return row.rosterId;
}

describeDb('link resolution across roster imports (§4, §7)', () => {
  beforeEach(resetDb);

  it('hands a linked member the auto-apply link once codes are exported', async () => {
    await importBatch([{ cardNumber: CARD }]);
    const event = await createEvent();
    await createLink('mac-user-1', 1, 'student_id');
    await provisionAndExport(event.id);

    const outcome = await resolveEventOutcome(await resolveLinkState(user()), event);
    expect(outcome).toEqual({
      state: 'code_ready',
      autoApplyUrl: `${event.humanitixEventUrl}?discountcode=${generateCode(CARD, event.id)}`,
    });
  });

  it('holds back the code until it has actually been exported', async () => {
    await importBatch([{ cardNumber: CARD }]);
    const event = await createEvent();
    await createLink('mac-user-1', 1, 'student_id');
    await provisionEventCodes(event.id); // provisioned, never downloaded

    const outcome = await resolveEventOutcome(await resolveLinkState(user()), event);
    expect(outcome).toEqual({ state: 'not_member', ticketUrl: event.humanitixEventUrl });
  });

  // The regression this harness exists for: a roster re-import replaces the
  // snapshot with brand-new row ids, which used to orphan every existing link and
  // silently downgrade members to the plain ticket link.
  it('keeps the auto-apply link working after the roster is re-imported', async () => {
    await importBatch([{ cardNumber: CARD }]);
    const event = await createEvent();
    await createLink('mac-user-1', 1, 'student_id');
    await provisionAndExport(event.id);

    await importBatch([{ cardNumber: CARD }]); // a fresh MSA export lands

    const state = await resolveLinkState(user());
    expect(state).toMatchObject({ status: 'linked', cardNumber: CARD });
    // Resolved to the *new* snapshot's row, not the one stored at link time.
    expect(state).toMatchObject({ rosterId: 2 });

    const outcome = await resolveEventOutcome(state, event);
    expect(outcome).toEqual({
      state: 'code_ready',
      autoApplyUrl: `${event.humanitixEventUrl}?discountcode=${generateCode(CARD, event.id)}`,
    });
  });

  // The exact production sequence that broke: someone links, a fresh roster is
  // imported, and only *then* are codes provisioned. Provisioning covers the new
  // snapshot's rows, so a link keyed on the old row id matched no code at all.
  it('reaches a member who linked before the import that preceded provisioning', async () => {
    await importBatch([{ cardNumber: CARD }]);
    const event = await createEvent();
    await createLink('mac-user-1', 1, 'student_id');

    await importBatch([{ cardNumber: CARD }]); // roster re-imported…
    await provisionAndExport(event.id); // …and only now are codes cut

    const outcome = await resolveEventOutcome(await resolveLinkState(user()), event);
    expect(outcome).toEqual({
      state: 'code_ready',
      autoApplyUrl: `${event.humanitixEventUrl}?discountcode=${generateCode(CARD, event.id)}`,
    });
  });

  // The second face of the same bug: UNIQUE(roster_id, event_id) only guards
  // within one batch, so each import used to mint a duplicate unexported row
  // carrying an identical code, which knocked an uploaded member back to plain.
  it('does not re-provision a member who already has a code for the event', async () => {
    await importBatch([{ cardNumber: CARD }]);
    const event = await createEvent();
    await createLink('mac-user-1', 1, 'student_id');
    await provisionAndExport(event.id);

    await importBatch([{ cardNumber: CARD }]);
    expect(await provisionEventCodes(event.id)).toBe(0);

    const { csv, count } = await buildEventCsv(event.id);
    expect(count).toBe(1);
    expect(csv.trim().split('\n')).toHaveLength(2); // header + one code
    const outcome = await resolveEventOutcome(await resolveLinkState(user()), event);
    expect(outcome.state).toBe('code_ready');
  });

  it('does not re-point the stored roster_id — it stays as the audit trail', async () => {
    await importBatch([{ cardNumber: CARD }]);
    await createLink('mac-user-1', 1, 'student_id');
    await importBatch([{ cardNumber: CARD }]);

    await resolveLinkState(user());
    expect(await linkedRosterId('mac-user-1')).toBe(1);
  });

  it('keeps a lapsed member on the link they already had (passive, §9)', async () => {
    await importBatch([{ cardNumber: CARD }]);
    const event = await createEvent();
    await createLink('mac-user-1', 1, 'student_id');
    await provisionAndExport(event.id);

    // ENROLLED → INACTIVE must not revoke anything.
    await importBatch([{ cardNumber: CARD, enrolled: false }]);

    const outcome = await resolveEventOutcome(await resolveLinkState(user()), event);
    expect(outcome.state).toBe('code_ready');
  });

  it('never re-matches on email once linked, even to a different roster row', async () => {
    await importBatch([
      { cardNumber: CARD, email: 'someone.else@example.com' },
      { cardNumber: '39999999', email: 'me@example.com' },
    ]);
    // Linked to row 1 despite the email pointing at row 2.
    await createLink('mac-user-1', 1, 'student_id');

    const state = await resolveLinkState(user('mac-user-1', 'me@example.com'));
    expect(state).toMatchObject({ status: 'linked', cardNumber: CARD });
  });

  it('falls back to the stored row when the link has no card number', async () => {
    await importBatch([{ cardNumber: null, email: 'me@example.com' }]);
    const event = await createEvent();
    await createLink('mac-user-1', 1, 'email_auto');

    const state = await resolveLinkState(user('mac-user-1', 'me@example.com'));
    expect(state).toMatchObject({ status: 'linked', rosterId: 1, cardNumber: null });
    // No codes are ever provisioned for a cardless row, so: plain link.
    const outcome = await resolveEventOutcome(state, event);
    expect(outcome).toEqual({ state: 'not_member', ticketUrl: event.humanitixEventUrl });
  });

  it('surfaces the student-ID field when nothing matches', async () => {
    await importBatch([{ cardNumber: CARD, email: 'someone.else@example.com' }]);
    const state = await resolveLinkState(user('mac-user-1', 'nobody@example.com'));
    expect(state.status).toBe('needs_student_id');
  });
});
