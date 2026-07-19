import { and, eq, isNull, sql, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { roster, memberEventCodes, auditLog } from '../db/schema.js';
import { latestImportBatchId } from '../roster/query.js';
import { generateCode } from './generate.js';

/**
 * Provision a member_event_codes row for every ENROLLED roster row (current
 * snapshot, with a card number) that doesn't already have one for this event
 * (§9). Idempotent — the UNIQUE(roster_id, event_id) constraint plus
 * onConflictDoNothing means re-running only fills gaps. Returns rows inserted.
 */
export async function provisionEventCodes(eventId: number): Promise<number> {
  const batch = await latestImportBatchId();
  if (!batch) return 0;

  const enrolled = await db
    .select({ id: roster.id, cardNumber: roster.cardNumber })
    .from(roster)
    .where(
      and(
        eq(roster.importBatchId, batch),
        eq(roster.enrollmentStatus, 'ENROLLED'),
        sql`${roster.cardNumber} is not null`,
      ),
    );

  if (enrolled.length === 0) return 0;

  const values = enrolled.map((r) => ({
    rosterId: r.id,
    eventId,
    code: generateCode(r.cardNumber, eventId),
  }));

  const inserted = await db
    .insert(memberEventCodes)
    .values(values)
    .onConflictDoNothing({
      target: [memberEventCodes.rosterId, memberEventCodes.eventId],
    })
    .returning({ id: memberEventCodes.id });

  if (inserted.length > 0) {
    await db.insert(auditLog).values({
      actorMacUserId: null,
      action: 'codes_provisioned',
      detail: { eventId, count: inserted.length },
    });
  }
  return inserted.length;
}

export interface PendingBatch {
  count: number;
  codeIds: number[];
  csv: string;
  oldestGeneratedAt: Date | null;
}

// Humanitix per-event discount CSV (§8). Column names are configurable in case
// Humanitix tweaks its upload template — the manual CSV upload is the intended
// design, so keep this easy to adjust rather than brittle.
const CSV_HEADER = process.env.HUMANITIX_CSV_HEADER ?? 'Code,Quantity,Max use per order';

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows: { code: string; quantity: number; maxUsePerOrder: number }[]): string {
  const lines = [CSV_HEADER];
  for (const r of rows) {
    lines.push([r.code, r.quantity, r.maxUsePerOrder].map(csvEscape).join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * Build the CSV of ALL codes for an event (whole set to upload to Humanitix),
 * regardless of export state, plus the ids of any not-yet-exported so the caller
 * can mark them exported after a manual download.
 */
export async function buildEventCsv(
  eventId: number,
): Promise<{ csv: string; count: number; unexportedIds: number[] }> {
  const rows = await db
    .select({
      id: memberEventCodes.id,
      code: memberEventCodes.code,
      quantity: memberEventCodes.quantity,
      maxUsePerOrder: memberEventCodes.maxUsePerOrder,
      exportedAt: memberEventCodes.exportedAt,
    })
    .from(memberEventCodes)
    .where(eq(memberEventCodes.eventId, eventId))
    .orderBy(asc(memberEventCodes.code));

  return {
    csv: rowsToCsv(rows),
    count: rows.length,
    unexportedIds: rows.filter((r) => r.exportedAt === null).map((r) => r.id),
  };
}

/** Build the un-exported (exported_at IS NULL) batch of codes for one event. */
export async function buildPendingBatch(eventId: number): Promise<PendingBatch> {
  const rows = await db
    .select({
      id: memberEventCodes.id,
      code: memberEventCodes.code,
      quantity: memberEventCodes.quantity,
      maxUsePerOrder: memberEventCodes.maxUsePerOrder,
      generatedAt: memberEventCodes.generatedAt,
    })
    .from(memberEventCodes)
    .where(and(eq(memberEventCodes.eventId, eventId), isNull(memberEventCodes.exportedAt)))
    .orderBy(asc(memberEventCodes.generatedAt));

  return {
    count: rows.length,
    codeIds: rows.map((r) => r.id),
    csv: rowsToCsv(rows),
    oldestGeneratedAt: rows[0]?.generatedAt ?? null,
  };
}

/** Mark a set of codes as exported (optimistic — §9: no upload confirmation). */
export async function markExported(codeIds: number[], now = new Date()): Promise<void> {
  if (codeIds.length === 0) return;
  await db
    .update(memberEventCodes)
    .set({ exportedAt: now })
    .where(sql`${memberEventCodes.id} = any(${codeIds})`);
  await db.insert(auditLog).values({
    actorMacUserId: null,
    action: 'codes_exported',
    detail: { count: codeIds.length },
  });
}
