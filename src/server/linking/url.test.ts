import { describe, it, expect } from 'vitest';
import { composeAutoApplyUrl } from './resolve.js';

describe('composeAutoApplyUrl (§8)', () => {
  it('appends the confirmed discountcode parameter', () => {
    expect(composeAutoApplyUrl('https://events.humanitix.com/mac-ball', 'ABC123')).toBe(
      'https://events.humanitix.com/mac-ball?discountcode=ABC123',
    );
  });

  it('uses & when the URL already has a query string', () => {
    expect(composeAutoApplyUrl('https://events.humanitix.com/mac-ball?utm=fb', 'ABC123')).toBe(
      'https://events.humanitix.com/mac-ball?utm=fb&discountcode=ABC123',
    );
  });

  it('url-encodes codes with special characters', () => {
    expect(composeAutoApplyUrl('https://x.com/e', 'A B+C')).toBe('https://x.com/e?discountcode=A%20B%2BC');
  });
});
