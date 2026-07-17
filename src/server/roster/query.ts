import { sql, desc, eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { roster, type RosterRow } from '../db/schema.js';
import { normalizeCardNumber } from './parse.js';

/** import_batch_id of the most recent import, or null if the roster is empty. */
export async function latestImportBatchId(): Promise<string | null> {
  const [row] = await db
    .select({ batch: roster.importBatchId })
    .from(roster)
    .orderBy(desc(roster.importedAt))
    .limit(1);
  return row?.batch ?? null;
}

/** Find an ENROLLED roster row in the current snapshot by email (case-insensitive). */
export async function findEnrolledByEmail(email: string): Promise<RosterRow | null> {
  const batch = await latestImportBatchId();
  if (!batch) return null;
  const [row] = await db
    .select()
    .from(roster)
    .where(
      and(
        eq(roster.importBatchId, batch),
        eq(roster.enrollmentStatus, 'ENROLLED'),
        sql`lower(${roster.email}) = ${email.trim().toLowerCase()}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Find an ENROLLED roster row in the current snapshot by student ID. Input is
 * normalized the same way the importer normalizes card_number (strip whitespace
 * and an Excel apostrophe, preserve leading zeros). Returns null on no match —
 * callers must NOT distinguish "not found" from "found but not ENROLLED" (§7).
 */
export async function findEnrolledByStudentId(studentId: string): Promise<RosterRow | null> {
  const normalized = normalizeCardNumber(studentId);
  if (!normalized) return null;
  const batch = await latestImportBatchId();
  if (!batch) return null;
  const [row] = await db
    .select()
    .from(roster)
    .where(
      and(
        eq(roster.importBatchId, batch),
        eq(roster.enrollmentStatus, 'ENROLLED'),
        eq(roster.cardNumber, normalized),
      ),
    )
    .limit(1);
  return row ?? null;
}
