import { describe, it, expect } from 'vitest';
import { safetyGateReason } from './import.js';

describe('safetyGateReason (§6)', () => {
  it('allows the first import when there is no existing roster', () => {
    expect(safetyGateReason(0, 0, false)).toBeNull();
    expect(safetyGateReason(0, 500, false)).toBeNull();
  });

  it('refuses an import that drops ENROLLED to zero', () => {
    expect(safetyGateReason(400, 0, false)).toMatch(/0 ENROLLED/);
  });

  it('refuses an import that drops ENROLLED below half', () => {
    expect(safetyGateReason(400, 199, false)).toMatch(/less than half/);
  });

  it('allows an import at exactly half', () => {
    expect(safetyGateReason(400, 200, false)).toBeNull();
  });

  it('allows a normal-sized import', () => {
    expect(safetyGateReason(400, 420, false)).toBeNull();
  });

  it('override bypasses the gate entirely', () => {
    expect(safetyGateReason(400, 0, true)).toBeNull();
    expect(safetyGateReason(400, 1, true)).toBeNull();
  });
});
