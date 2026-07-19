import { Router } from 'express';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, memberEventCodes, auditLog } from '../db/schema.js';
import { requireAdmin } from '../auth/mac-auth.js';
import { onEventPublished } from '../codes/cron.js';
import { provisionEventCodes, buildEventCsv, markExported } from '../codes/provision.js';

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

// GET /api/admin/events — with a per-event count of generated codes.
eventsAdminRouter.get('/', requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      humanitixEventUrl: events.humanitixEventUrl,
      active: events.active,
      createdAt: events.createdAt,
      codeCount: sql<number>`count(${memberEventCodes.id})::int`,
    })
    .from(events)
    .leftJoin(memberEventCodes, eq(memberEventCodes.eventId, events.id))
    .groupBy(events.id)
    .orderBy(events.name);
  res.json(rows);
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
  const [event] = await db.select().from(events).where(eq(events.id, id));
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

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="codes-${event.slug}.csv"`);
  res.send(csv);
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
      res.status(409).json({ error: 'slug_taken' });
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
