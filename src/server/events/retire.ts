import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, auditLog, type Event } from '../db/schema.js';

/**
 * SQL predicate for "this event has not finished yet". Events with no dates at
 * all count as not-passed — they're the manually-entered ones with nothing to
 * judge them by. Used both to retire rows and to filter reads, so a passed event
 * disappears immediately rather than waiting for the next cron run.
 */
export function notPassedSql(now = new Date()) {
  const cutoff = now.toISOString();
  return sql`coalesce(${events.endDate}, ${events.startDate} + interval '1 day', ${cutoff}::timestamptz) >= ${cutoff}::timestamptz`;
}

/**
 * Deactivate events whose date has passed.
 *
 * "Passed" = the end date is behind us, or (for events that only carry a start
 * date) a day past the start. Events with no dates at all — manually-entered
 * ones, typically — are never touched automatically; an officer flips those.
 *
 * Deactivating, never deleting: the row, its codes, and the audit trail all stay
 * queryable. Codes already uploaded to Humanitix are Humanitix's problem (§ the
 * passive-on-lapse rule) — this only stops us provisioning, listing, and serving
 * the verify page for an event that is over.
 */
export async function deactivatePastEvents(now = new Date()): Promise<Event[]> {
  const retired = await db
    .update(events)
    .set({ active: false })
    .where(and(isNull(events.deletedAt), eq(events.active, true), sql`not (${notPassedSql(now)})`))
    .returning();

  if (retired.length > 0) {
    await db.insert(auditLog).values(
      retired.map((e) => ({
        actorMacUserId: null,
        action: 'event_auto_retired',
        detail: {
          eventId: e.id,
          slug: e.slug,
          endDate: e.endDate?.toISOString() ?? null,
          startDate: e.startDate?.toISOString() ?? null,
        },
      })),
    );
  }
  return retired;
}

/** Has this event's date passed? Same rule as `deactivatePastEvents`, for display. */
export function hasPassed(
  event: { startDate: Date | string | null; endDate: Date | string | null },
  now = new Date(),
): boolean {
  const end = event.endDate ? new Date(event.endDate) : null;
  if (end) return end.getTime() < now.getTime();
  const start = event.startDate ? new Date(event.startDate) : null;
  if (start) return start.getTime() + 24 * 60 * 60 * 1000 < now.getTime();
  return false;
}
