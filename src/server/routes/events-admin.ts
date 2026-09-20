import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, memberEventCodes, auditLog } from '../db/schema.js';
import { requireAdmin } from '../auth/mac-auth.js';
import { onEventPublished } from '../codes/cron.js';
import { deactivatePastEvents } from '../events/retire.js';
import { syncLiveEvents } from '../events/sync.js';
import { provisionEventCodes, buildEventCsv, markExported, revertEventExport } from '../codes/provision.js';

export const eventsAdminRouter = Router();

const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const createSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).regex(slugRe, 'slug must be kebab-case'),
  humanitixEventUrl: z.string().url().max(500),
  active: z.boolean().optional().default(true),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(200).regex(slugRe).optional(),
  humanitixEventUrl: z.string().url().max(500).optional(),
  active: z.boolean().optional(),
});

// Trigger A can hit Discord; never let a webhook hiccup fail the DB write. The
// daily diff (Trigger B) will retry provisioning/export for anything left over.
async function fireTriggerA(eventId: number): Promise<{ provisioned: number; exported: number } | { error: string }> {
  try {
    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    if (!event) return { error: 'event vanished' };
    return await onEventPublished(event);
  } catch (err) {
    console.error('[events-admin] trigger A failed', err);
    return { error: (err as Error).message };
  }
}

// GET /api/admin/events — every event this app knows about, with a per-event
// count of generated codes. Pulls the live Humanitix list in and retires anything
// whose date has passed first, so this one list *is* the whole picture: live
// Humanitix events with fresh preview metadata, manual entries, and past events,
// with no finished event shown as live. (The daily cron does the same; this just
// means an officer opening the page doesn't have to wait for it.) Code
// provisioning for newly-synced events is left to the cron.
//
// The `sync` block tells the panel whether the Humanitix pull actually happened,
// so a missing event reads as "sync is off/broken" rather than "no such event".
//
// Removed events come back too, carrying `deletedAt` — the panel tucks them into
// their own collapsed section so a mistaken removal can be undone. Nothing else
// in the app reads them (see `notDeleted` in events/query.ts).
eventsAdminRouter.get('/', requireAdmin, async (_req, res) => {
  const sync = await syncLiveEvents();
  if (sync.error) console.error('[events-admin] humanitix sync failed', sync.error);
  await deactivatePastEvents();
  const rows = await db
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      humanitixEventUrl: events.humanitixEventUrl,
      humanitixEventId: events.humanitixEventId,
      active: events.active,
      startDate: events.startDate,
      endDate: events.endDate,
      createdAt: events.createdAt,
      codesOnHold: events.codesOnHold,
      deletedAt: events.deletedAt,
      codeCount: sql<number>`count(${memberEventCodes.id})::int`,
      exportedCount: sql<number>`count(${memberEventCodes.exportedAt})::int`,
    })
    .from(events)
    .leftJoin(memberEventCodes, eq(memberEventCodes.eventId, events.id))
    .groupBy(events.id)
    .orderBy(desc(events.active), desc(sql`coalesce(${events.startDate}, ${events.createdAt})`));
  res.json({ sync: { configured: sync.configured, error: sync.error ?? null }, events: rows });
});

// GET /api/admin/events/:id/codes.csv — the full Humanitix discount CSV for an
// event. Provisions any missing codes first (so newly-linked members are always
// included), then marks the batch exported (optimistic, §9).
eventsAdminRouter.get('/:id/codes.csv', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)));
  if (!event) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  await provisionEventCodes(id);
  const { csv, count, unexportedIds } = await buildEventCsv(id);
  if (count === 0) {
    res.status(409).json({ error: 'no_codes', message: 'No enrolled members to generate codes for — import the roster first.' });
    return;
  }
  await markExported(unexportedIds);
  // Downloading again is the officer saying "these are going up now" — lift any hold.
  if (event.codesOnHold) await db.update(events).set({ codesOnHold: false }).where(eq(events.id, id));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="codes-${event.slug}.csv"`);
  res.send(csv);
});

// POST /api/admin/events/:id/codes/revert-export — undo an accidental CSV
// download. Members go back to the plain ticket link for this event, and the
// event stays out of the automatic export until the CSV is downloaded again.
// Codes themselves are kept (never hard-deleted), and so is each member's code
// value, so a later download reproduces the same CSV.
eventsAdminRouter.post('/:id/codes/revert-export', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, id));
  if (!event) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const reverted = await revertEventExport(id, req.macUser?.macUserId ?? null);
  res.json({ reverted });
});

// POST /api/admin/events
eventsAdminRouter.post('/', requireAdmin, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', issues: parsed.error.flatten() });
    return;
  }
  try {
    const [created] = await db.insert(events).values(parsed.data).returning();
    await db.insert(auditLog).values({
      actorMacUserId: req.macUser?.macUserId ?? null,
      action: 'event_created',
      detail: { eventId: created!.id, slug: created!.slug },
    });
    const provisioning = created!.active ? await fireTriggerA(created!.id) : null;
    res.status(201).json({ event: created, provisioning });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      // A removed event keeps its slug, so "that slug is taken" can point at a
      // row the officer can no longer see. Say which it is — restoring beats
      // inventing a second slug for the same event.
      const [removed] = await db
        .select({ id: events.id })
        .from(events)
        .where(and(eq(events.slug, parsed.data.slug), sql`${events.deletedAt} is not null`));
      res.status(409).json({ error: 'slug_taken', removedEventId: removed?.id ?? null });
      return;
    }
    throw err;
  }
});

// PATCH /api/admin/events/:id — activating (false→true) fires Trigger A.
eventsAdminRouter.patch('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', issues: parsed.error.flatten() });
    return;
  }

  const [before] = await db.select().from(events).where(eq(events.id, id));
  if (!before) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  try {
    const [updated] = await db.update(events).set(parsed.data).where(eq(events.id, id)).returning();
    const activated = !before.active && updated!.active;
    const provisioning = activated ? await fireTriggerA(id) : null;
    res.json({ event: updated, provisioning });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'slug_taken' });
      return;
    }
    throw err;
  }
});

// DELETE /api/admin/events/:id — remove an event from the admin list.
//
// Soft: the row is kept and so are its codes (CLAUDE.md — nothing about a
// member's history gets hard-deleted, and a code may already be live on
// Humanitix). Removing hides the event everywhere — the admin list, the verify
// pages, and code provisioning — and, crucially, survives the Humanitix sync: a
// removed event that is still live on Humanitix would otherwise reappear on the
// next page load.
//
// This is the "wrong event / duplicate / we're not doing member pricing for this
// one" button, not a retirement one — past events retire themselves.
eventsAdminRouter.delete('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const [event] = await db
    .select({ id: events.id, slug: events.slug })
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)));
  if (!event) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  // active:false as well, so anything reading the flag directly (rather than
  // going through getActiveEvents) can't hand out a link for a removed event.
  const [updated] = await db
    .update(events)
    .set({ deletedAt: new Date(), active: false })
    .where(eq(events.id, id))
    .returning();
  await db.insert(auditLog).values({
    actorMacUserId: req.macUser?.macUserId ?? null,
    action: 'event_removed',
    detail: { eventId: id, slug: event.slug },
  });
  res.json({ event: updated });
});

// POST /api/admin/events/:id/restore — undo a removal.
//
// Comes back inactive whatever it was before: reactivating is the thing that
// fires code provisioning, so an officer says that separately and on purpose.
// A restored event that is still live on Humanitix is picked up by the next sync.
eventsAdminRouter.post('/:id/restore', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const [updated] = await db
    .update(events)
    .set({ deletedAt: null })
    .where(eq(events.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  await db.insert(auditLog).values({
    actorMacUserId: req.macUser?.macUserId ?? null,
    action: 'event_restored',
    detail: { eventId: id, slug: updated.slug },
  });
  res.json({ event: updated });
});
