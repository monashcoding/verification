import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, auditLog, type Event } from '../db/schema.js';
import type { HumanitixEvent } from '../humanitix/client.js';

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
}

/**
 * Get (or create) the internal events row that mirrors a Humanitix event, keyed
 * on the Humanitix `_id`. Idempotent — codes are keyed on our internal event id,
 * so this is what lets "download CSV for a live Humanitix event" work without the
 * officer hand-entering the URL. Returns the internal Event.
 */
export async function upsertFromHumanitix(hx: HumanitixEvent): Promise<Event> {
  const [existing] = await db.select().from(events).where(eq(events.humanitixEventId, hx.id));
  if (existing) return existing;

  const base = slugify(hx.slug || hx.name);
  // Keep the slug unique even if two Humanitix events slugify the same.
  const candidates = [base, `${base}-${hx.id.slice(-6)}`];

  for (const slug of candidates) {
    const inserted = await db
      .insert(events)
      .values({
        name: hx.name,
        slug,
        humanitixEventUrl: hx.url,
        humanitixEventId: hx.id,
        active: true,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) {
      await db.insert(auditLog).values({
        actorMacUserId: null,
        action: 'event_synced_from_humanitix',
        detail: { eventId: inserted[0].id, humanitixEventId: hx.id, slug },
      });
      return inserted[0];
    }
    // Conflict could be the slug OR a concurrent insert of the same humanitix id.
    const [now] = await db.select().from(events).where(eq(events.humanitixEventId, hx.id));
    if (now) return now;
  }
  throw new Error(`could not create internal event for humanitix ${hx.id}`);
}
