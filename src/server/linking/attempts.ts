import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { rosterLinkAttempts } from '../db/schema.js';

// Rate limiting for the student-ID field (§4, §7). Persisted in the DB — a page
// reload must not reset the counter. This exists to stop scripted enumeration of
// student IDs (its only real threat), not to inconvenience real members, so the
// cap is deliberately generous: a genuine mistyper effectively never hits it,
// while automated guessing is still throttled. Counter resets after the window
// from the last attempt.

export const MAX_FAILED_ATTEMPTS = 20;
export const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export interface AttemptState {
  /** Effective failed count after applying the 24h reset window. */
  failedCount: number;
  /** True once the cap is reached within the cooldown window. */
  locked: boolean;
  remaining: number;
}

interface AttemptRow {
  failedCount: number;
  lastAttemptAt: Date;
}

/**
 * Pure decision: given the stored row (or null) and the current time, what is
 * the effective attempt state? Attempts older than the cooldown window reset the
 * counter to zero.
 */
export function attemptState(row: AttemptRow | null, now: Date): AttemptState {
  if (!row) return { failedCount: 0, locked: false, remaining: MAX_FAILED_ATTEMPTS };

  const expired = now.getTime() - row.lastAttemptAt.getTime() >= COOLDOWN_MS;
  const failedCount = expired ? 0 : row.failedCount;
  const locked = failedCount >= MAX_FAILED_ATTEMPTS;
  return { failedCount, locked, remaining: Math.max(0, MAX_FAILED_ATTEMPTS - failedCount) };
}

export async function getAttemptState(macUserId: string, now = new Date()): Promise<AttemptState> {
  const [row] = await db
    .select({ failedCount: rosterLinkAttempts.failedCount, lastAttemptAt: rosterLinkAttempts.lastAttemptAt })
    .from(rosterLinkAttempts)
    .where(eq(rosterLinkAttempts.macUserId, macUserId));
  return attemptState(row ?? null, now);
}

/**
 * Record a failed student-ID attempt and return the resulting state. If the
 * previous attempt was outside the cooldown window, the counter restarts at 1.
 */
export async function recordFailedAttempt(macUserId: string, now = new Date()): Promise<AttemptState> {
  const [existing] = await db
    .select({ failedCount: rosterLinkAttempts.failedCount, lastAttemptAt: rosterLinkAttempts.lastAttemptAt })
    .from(rosterLinkAttempts)
    .where(eq(rosterLinkAttempts.macUserId, macUserId));

  const state = attemptState(existing ?? null, now);
  const nextCount = state.failedCount + 1;

  if (existing) {
    await db
      .update(rosterLinkAttempts)
      .set({ failedCount: nextCount, lastAttemptAt: now })
      .where(eq(rosterLinkAttempts.macUserId, macUserId));
  } else {
    await db.insert(rosterLinkAttempts).values({ macUserId, failedCount: nextCount, lastAttemptAt: now });
  }

  const locked = nextCount >= MAX_FAILED_ATTEMPTS;
  return { failedCount: nextCount, locked, remaining: Math.max(0, MAX_FAILED_ATTEMPTS - nextCount) };
}
