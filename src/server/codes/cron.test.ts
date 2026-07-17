import { describe, it, expect } from 'vitest';
import { shouldExport, BATCH_MIN_SIZE, MAX_PENDING_AGE_MS } from './cron.js';

const NOW = new Date('2026-07-18T12:00:00Z');

describe('shouldExport (§9 Trigger B, §10 cadence)', () => {
  it('never exports an empty batch', () => {
    expect(shouldExport(0, null, NOW)).toBe(false);
    expect(shouldExport(0, new Date(0), NOW)).toBe(false);
  });

  it('exports as soon as the batch reaches the minimum size', () => {
    expect(shouldExport(BATCH_MIN_SIZE, new Date(NOW), NOW)).toBe(true);
  });

  it('holds a small, fresh batch (waits for it to grow)', () => {
    const oneDayOld = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(shouldExport(1, oneDayOld, NOW)).toBe(false);
  });

  it('exports a small batch once its oldest code passes a week', () => {
    const old = new Date(NOW.getTime() - MAX_PENDING_AGE_MS);
    expect(shouldExport(1, old, NOW)).toBe(true);
  });
});
