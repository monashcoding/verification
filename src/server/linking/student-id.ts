import { auditLog } from '../db/schema.js';
import { db } from '../db/index.js';
import { findEnrolledByStudentId } from '../roster/query.js';
import { createLink } from './resolve.js';
import { getAttemptState, recordFailedAttempt, type AttemptState } from './attempts.js';

// Single generic retry message — never reveals which part of the check failed
// (wrong number / not ENROLLED / not found at all) (§7, §13).
export const GENERIC_RETRY_MESSAGE = 'That student ID didn’t match. Check the number and try again.';

export type StudentIdResult =
  | { outcome: 'linked'; rosterId: number }
  // Under the cap — allow another try. `attempts` carries remaining count.
  | { outcome: 'retry'; message: string; attempts: AttemptState }
  // At/over the cap this cooldown window — drop to not-linked (§7).
  | { outcome: 'locked' };

/**
 * Handle a student-ID submission (§7 "Student ID step"). Checks the rate-limit
 * gate first, matches against ENROLLED roster rows, and either links or records
 * a failed attempt. The caller must already have an authenticated mac_user_id.
 */
export async function submitStudentId(
  macUserId: string,
  studentId: string,
  now = new Date(),
): Promise<StudentIdResult> {
  // Gate before doing any work — a locked user cannot spend more attempts.
  const gate = await getAttemptState(macUserId, now);
  if (gate.locked) return { outcome: 'locked' };

  const match = await findEnrolledByStudentId(studentId);
  if (match) {
    const rosterId = await createLink(macUserId, match.id, 'student_id');
    return { outcome: 'linked', rosterId };
  }

  const attempts = await recordFailedAttempt(macUserId, now);
  if (attempts.locked) {
    await db.insert(auditLog).values({
      actorMacUserId: macUserId,
      action: 'link_attempts_exhausted',
      detail: { failedCount: attempts.failedCount },
    });
    return { outcome: 'locked' };
  }
  return { outcome: 'retry', message: GENERIC_RETRY_MESSAGE, attempts };
}
