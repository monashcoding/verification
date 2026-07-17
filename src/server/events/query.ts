import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, type Event } from '../db/schema.js';

export async function getActiveEvents(): Promise<Event[]> {
  return db.select().from(events).where(eq(events.active, true)).orderBy(asc(events.name));
}

export async function getEventBySlug(slug: string, activeOnly = true): Promise<Event | null> {
  const conditions = activeOnly
    ? and(eq(events.slug, slug), eq(events.active, true))
    : eq(events.slug, slug);
  const [row] = await db.select().from(events).where(conditions).limit(1);
  return row ?? null;
}
