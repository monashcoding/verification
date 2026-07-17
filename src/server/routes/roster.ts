import { Router } from 'express';
import multer from 'multer';
import { sql, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { roster } from '../db/schema.js';
import { requireAdmin } from '../auth/mac-auth.js';
import { importRoster, RosterSafetyError, currentEnrolledCount } from '../roster/import.js';
import { RosterParseError } from '../roster/parse.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — generous for an xlsx export.
});

export const rosterRouter = Router();

// POST /api/admin/roster/import  (multipart: file=<xlsx>, override=true|false)
rosterRouter.post('/import', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'no file uploaded (field name must be "file")' });
    return;
  }
  const override = String(req.body?.override ?? '').toLowerCase() === 'true';
  try {
    const result = await importRoster(req.file.buffer, {
      override,
      actorMacUserId: req.macUser?.macUserId ?? null,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof RosterSafetyError) {
      res.status(409).json({
        error: 'safety_gate',
        message: err.message,
        currentEnrolled: err.currentEnrolled,
        incomingEnrolled: err.incomingEnrolled,
        hint: 'Re-submit with override=true if this file is correct.',
      });
      return;
    }
    if (err instanceof RosterParseError) {
      res.status(422).json({ error: 'parse_error', message: err.message });
      return;
    }
    throw err;
  }
});

// GET /api/admin/roster/summary — current roster visibility (independently useful).
rosterRouter.get('/summary', requireAdmin, async (_req, res) => {
  const [latest] = await db
    .select({ batch: roster.importBatchId, importedAt: roster.importedAt })
    .from(roster)
    .orderBy(desc(roster.importedAt))
    .limit(1);

  if (!latest) {
    res.json({ hasRoster: false, total: 0, enrolled: 0, inactive: 0 });
    return;
  }

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      enrolled: sql<number>`count(*) filter (where ${roster.enrollmentStatus} = 'ENROLLED')::int`,
      inactive: sql<number>`count(*) filter (where ${roster.enrollmentStatus} = 'INACTIVE')::int`,
    })
    .from(roster)
    .where(sql`${roster.importBatchId} = ${latest.batch}`);

  res.json({
    hasRoster: true,
    importBatchId: latest.batch,
    importedAt: latest.importedAt,
    total: counts?.total ?? 0,
    enrolled: counts?.enrolled ?? 0,
    inactive: counts?.inactive ?? 0,
  });
});

export { currentEnrolledCount };
