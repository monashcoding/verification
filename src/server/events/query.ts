import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, type Event } from '../db/schema.js';
import { notPassedSql } from './retire.js';

// "Active" means both flagged active *and* not yet finished. The date check is
// belt-and-braces with `deactivatePastEvents` (which flips the flag on the daily
// cron) — it means an event that ends between cron runs stops being served the
// moment it's over.
export async function getActiveEvents(): Promise<Event[]> {
  return db
    .select()
    .from(events)
    .where(and(eq(events.active, true), notPassedSql()))
    // Newest first, same order as the admin list — manual events without a
    // date fall back to when they were added.
    .orderBy(desc(sql`coalesce(${events.startDate}, ${events.createdAt})`), desc(events.createdAt));
}

export async function getEventBySlug(slug: string, activeOnly = true): Promise<Event | null> {
  const conditions = activeOnly
    ? and(eq(events.slug, slug), eq(events.active, true), notPassedSql())
    : eq(events.slug, slug);
  const [row] = await db.select().from(events).where(conditions).limit(1);
  return row ?? null;
}
