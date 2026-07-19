import { Router } from 'express';
import { inArray, sql, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, memberEventCodes } from '../db/schema.js';
import { requireAdmin } from '../auth/mac-auth.js';
import {
  listLiveEvents,
  getEvent,
  humanitixConfigured,
  HumanitixNotConfigured,
  HumanitixError,
} from '../humanitix/client.js';
import { upsertFromHumanitix } from '../events/upsert.js';
import { provisionEventCodes, buildEventCsv, markExported } from '../codes/provision.js';

export const humanitixAdminRouter = Router();

// GET /api/admin/humanitix/events — live Humanitix events, each annotated with
// whether we've already synced it internally and how many codes exist.
humanitixAdminRouter.get('/events', requireAdmin, async (_req, res) => {
  if (!humanitixConfigured()) {
    res.status(501).json({
      error: 'not_configured',
      message: 'Set HUMANITIX_API_KEY to list events automatically. You can still add events manually.',
    });
    return;
  }

  let live;
  try {
    live = await listLiveEvents();
  } catch (err) {
    if (err instanceof HumanitixNotConfigured) {
      res.status(501).json({ error: 'not_configured' });
      return;
    }
    if (err instanceof HumanitixError) {
      res.status(502).json({ error: 'humanitix_error', message: err.message });
      return;
    }
    throw err;
  }

  // Which of these are already synced internally, and their code counts.
  const ids = live.map((e) => e.id);
  const internal = ids.length
    ? await db
        .select({
          humanitixEventId: events.humanitixEventId,
          slug: events.slug,
          codeCount: sql<number>`count(${memberEventCodes.id})::int`,
        })
        .from(events)
        .leftJoin(memberEventCodes, eq(memberEventCodes.eventId, events.id))
        .where(inArray(events.humanitixEventId, ids))
        .groupBy(events.humanitixEventId, events.slug)
    : [];
  const byId = new Map(internal.map((r) => [r.humanitixEventId, r]));

  res.json(
    live.map((e) => ({
      humanitixEventId: e.id,
      name: e.name,
      url: e.url,
      startDate: e.startDate,
      endDate: e.endDate,
      synced: byId.has(e.id),
      slug: byId.get(e.id)?.slug ?? null,
      codeCount: byId.get(e.id)?.codeCount ?? 0,
    })),
  );
});

// GET /api/admin/humanitix/events/:hxId/codes.csv — the one-click path: ensure an
// internal event exists for this Humanitix event, provision codes, return the CSV.
humanitixAdminRouter.get('/events/:hxId/codes.csv', requireAdmin, async (req, res) => {
  const hxId = typeof req.params.hxId === 'string' ? req.params.hxId : '';
  if (!hxId) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  if (!humanitixConfigured()) {
    res.status(501).json({ error: 'not_configured' });
    return;
  }

  let hxEvent;
  try {
    hxEvent = await getEvent(hxId);
  } catch (err) {
    if (err instanceof HumanitixError) {
      res.status(502).json({ error: 'humanitix_error', message: err.message });
      return;
    }
    throw err;
  }

  const event = await upsertFromHumanitix(hxEvent);
  await provisionEventCodes(event.id);
  const { csv, count, unexportedIds } = await buildEventCsv(event.id);
  if (count === 0) {
    res.status(409).json({
      error: 'no_codes',
      message: 'No enrolled members to generate codes for — import the roster first.',
    });
    return;
  }
  await markExported(unexportedIds);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="codes-${event.slug}.csv"`);
  res.send(csv);
});
