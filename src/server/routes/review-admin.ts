import { Router } from 'express';
import { z } from 'zod';
import { desc, eq, and, gte, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { rosterLinkAttempts, memberLinks, roster, auditLog } from '../db/schema.js';
import { requireAdmin } from '../auth/mac-auth.js';
import { MAX_FAILED_ATTEMPTS } from '../linking/attempts.js';
import { createLink } from '../linking/resolve.js';
import { latestImportBatchId } from '../roster/query.js';

// Manual review queue (§11, build-order step 9). Genuinely rare now that student
// ID is the primary path — this is opt-in, for someone who exhausted attempts and
// asked to be reviewed. An officer confirms membership by other means and creates
// a member_links row manually.
export const reviewAdminRouter = Router();

// GET /api/admin/review — accounts that have hit the attempt cap and aren't linked.
reviewAdminRouter.get('/', requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      macUserId: rosterLinkAttempts.macUserId,
      failedCount: rosterLinkAttempts.failedCount,
      lastAttemptAt: rosterLinkAttempts.lastAttemptAt,
    })
    .from(rosterLinkAttempts)
    .leftJoin(memberLinks, eq(memberLinks.macUserId, rosterLinkAttempts.macUserId))
    .where(and(gte(rosterLinkAttempts.failedCount, MAX_FAILED_ATTEMPTS), isNull(memberLinks.id)))
    .orderBy(desc(rosterLinkAttempts.lastAttemptAt));

  res.json(rows);
});

// GET /api/admin/review/roster-search?q=  — help an officer find the roster row.
// Searches current-snapshot ENROLLED rows by name / student ID / email.
reviewAdminRouter.get('/roster-search', requireAdmin, async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) {
    res.status(400).json({ error: 'query too short' });
    return;
  }
  const batch = await latestImportBatchId();
  if (!batch) {
    res.json([]);
    return;
  }
  const like = `%${q.toLowerCase()}%`;
  const rows = await db
    .select({
      id: roster.id,
      firstName: roster.firstName,
      lastName: roster.lastName,
      cardNumber: roster.cardNumber,
      email: roster.email,
      enrollmentStatus: roster.enrollmentStatus,
    })
    .from(roster)
    .where(
      and(
        eq(roster.importBatchId, batch),
        sql`(
          lower(${roster.firstName}) like ${like} or
          lower(${roster.lastName}) like ${like} or
          lower(${roster.email}) like ${like} or
          ${roster.cardNumber} like ${`%${q}%`}
        )`,
      ),
    )
    .limit(25);
  res.json(rows);
});

const linkSchema = z.object({
  macUserId: z.string().min(1),
  rosterId: z.number().int().positive(),
});

// POST /api/admin/review/link — officer manually links an account to a roster row.
reviewAdminRouter.post('/link', requireAdmin, async (req, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const { macUserId, rosterId } = parsed.data;

  const [target] = await db.select({ id: roster.id }).from(roster).where(eq(roster.id, rosterId));
  if (!target) {
    res.status(404).json({ error: 'roster_row_not_found' });
    return;
  }

  const resolvedRosterId = await createLink(macUserId, rosterId, 'manual_review');
  await db.insert(auditLog).values({
    actorMacUserId: req.macUser?.macUserId ?? null,
    action: 'manual_review_link',
    detail: { macUserId, rosterId: resolvedRosterId },
  });
  res.json({ ok: true, macUserId, rosterId: resolvedRosterId });
});
