import { describe, it, expect } from 'vitest';
import { generateCode } from './generate.js';

describe('generateCode (§4)', () => {
  it('is deterministic for the same card number + event', () => {
    expect(generateCode('31234567', 42)).toBe(generateCode('31234567', 42));
  });

  it('differs across events for the same member (per-event, not global)', () => {
    expect(generateCode('31234567', 1)).not.toBe(generateCode('31234567', 2));
  });

  it('differs across members for the same event', () => {
    expect(generateCode('31234567', 1)).not.toBe(generateCode('39999999', 1));
  });

  it('produces a readable prefixed code with no ambiguous characters', () => {
    const code = generateCode('31234567', 1);
    expect(code).toMatch(/^MAC-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(code).not.toMatch(/[ILOU]/);
  });
});
