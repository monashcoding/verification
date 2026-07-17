import { randomUUID } from 'node:crypto';
import { sql, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { roster, auditLog, type NewRosterRow } from '../db/schema.js';
import { parseRosterWorkbook } from './parse.js';

export class RosterSafetyError extends Error {
  constructor(
    message: string,
    readonly currentEnrolled: number,
    readonly incomingEnrolled: number,
  ) {
    super(message);
  }
}

function countEnrolled(rows: NewRosterRow[]): number {
  return rows.filter((r) => r.enrollmentStatus === 'ENROLLED').length;
}

/**
 * Pure safety-gate decision (§6). Returns a rejection reason, or null to allow.
 * With no existing roster, any import is allowed (bootstrapping the first one).
 */
export function safetyGateReason(
  previousEnrolled: number,
  incomingEnrolled: number,
  override: boolean,
): string | null {
  if (override || previousEnrolled === 0) return null;
  if (incomingEnrolled === 0) {
    return `Refusing import: incoming roster has 0 ENROLLED members (currently ${previousEnrolled}). ` +
      'Pass override to proceed.';
  }
  if (incomingEnrolled * 2 < previousEnrolled) {
    return `Refusing import: incoming ENROLLED count ${incomingEnrolled} is less than half the current ` +
      `${previousEnrolled}. Likely a wrong sheet or partial download. Pass override to proceed.`;
  }
  return null;
}

/** Current ENROLLED count from the most recent import batch. */
export async function currentEnrolledCount(): Promise<number> {
  const [latest] = await db
    .select({ batch: roster.importBatchId })
    .from(roster)
    .orderBy(desc(roster.importedAt))
    .limit(1);
  if (!latest) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(roster)
    .where(sql`${roster.importBatchId} = ${latest.batch} and ${roster.enrollmentStatus} = 'ENROLLED'`);
  return row?.n ?? 0;
}

export interface ImportResult {
  importBatchId: string;
  totalRows: number;
  enrolledRows: number;
  previousEnrolled: number;
  overrideUsed: boolean;
}

/**
 * Parse and import a roster workbook, replacing the roster snapshot wholesale.
 *
 * Safety gate (§6): refuse an import whose ENROLLED count is zero, or less than
 * half the current ENROLLED count, unless `override` is true. Prior batches are
 * kept queryable (we do not delete them) — the "current" roster is simply the
 * latest import_batch_id.
 */
export async function importRoster(
  buffer: Buffer,
  opts: { override?: boolean; actorMacUserId?: string | null } = {},
): Promise<ImportResult> {
  const importBatchId = randomUUID();
  const parsed = parseRosterWorkbook(buffer, importBatchId);

  const incomingEnrolled = countEnrolled(parsed);
  const previousEnrolled = await currentEnrolledCount();
  const override = opts.override ?? false;

  const rejection = safetyGateReason(previousEnrolled, incomingEnrolled, override);
  if (rejection) {
    throw new RosterSafetyError(rejection, previousEnrolled, incomingEnrolled);
  }

  await db.insert(roster).values(parsed);
  await db.insert(auditLog).values({
    actorMacUserId: opts.actorMacUserId ?? null,
    action: 'roster_import',
    detail: {
      importBatchId,
      totalRows: parsed.length,
      enrolledRows: incomingEnrolled,
      previousEnrolled,
      overrideUsed: override,
    },
  });

  return {
    importBatchId,
    totalRows: parsed.length,
    enrolledRows: incomingEnrolled,
    previousEnrolled,
    overrideUsed: override,
  };
}
