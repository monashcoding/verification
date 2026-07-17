import { describe, it, expect } from 'vitest';
import { attemptState, MAX_FAILED_ATTEMPTS, COOLDOWN_MS } from './attempts.js';

const NOW = new Date('2026-07-18T12:00:00Z');

describe('attemptState (§4, §7 rate limiting)', () => {
  it('starts fresh with no stored row', () => {
    expect(attemptState(null, NOW)).toEqual({
      failedCount: 0,
      locked: false,
      remaining: MAX_FAILED_ATTEMPTS,
    });
  });

  it('counts recent failures and reports remaining', () => {
    const row = { failedCount: 2, lastAttemptAt: new Date(NOW.getTime() - 60_000) };
    expect(attemptState(row, NOW)).toEqual({ failedCount: 2, locked: false, remaining: 3 });
  });

  it('locks at the cap within the cooldown window', () => {
    const row = { failedCount: MAX_FAILED_ATTEMPTS, lastAttemptAt: new Date(NOW.getTime() - 3600_000) };
    expect(attemptState(row, NOW).locked).toBe(true);
    expect(attemptState(row, NOW).remaining).toBe(0);
  });

  it('resets the counter once the cooldown window elapses (survives reload, not time)', () => {
    const row = { failedCount: MAX_FAILED_ATTEMPTS, lastAttemptAt: new Date(NOW.getTime() - COOLDOWN_MS) };
    const state = attemptState(row, NOW);
    expect(state.locked).toBe(false);
    expect(state.failedCount).toBe(0);
  });

  it('stays locked one millisecond before the window elapses', () => {
    const row = {
      failedCount: MAX_FAILED_ATTEMPTS,
      lastAttemptAt: new Date(NOW.getTime() - (COOLDOWN_MS - 1)),
    };
    expect(attemptState(row, NOW).locked).toBe(true);
  });
});
