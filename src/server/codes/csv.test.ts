import { describe, it, expect } from 'vitest';
import { rowsToCsv } from './provision.js';

const row = (code: string) => ({ code, quantity: 1, maxUsePerOrder: 1 });

describe('rowsToCsv (§8 Humanitix upload)', () => {
  it('writes a header plus one line per code', () => {
    expect(rowsToCsv([row('MAC-AAAA1111'), row('MAC-BBBB2222')])).toBe(
      'Code,Quantity,Max use per order\nMAC-AAAA1111,1,1\nMAC-BBBB2222,1,1\n',
    );
  });

  // Regression: a roster import used to mint a second code row for the same
  // member (new batch, new roster_id, identical code), which put the same code
  // in the upload twice.
  it('never repeats a code, even given duplicate rows', () => {
    const csv = rowsToCsv([row('MAC-AAAA1111'), row('MAC-AAAA1111'), row('MAC-BBBB2222')]);
    expect(csv.match(/MAC-AAAA1111/g)).toHaveLength(1);
    expect(csv.trim().split('\n')).toHaveLength(3);
  });
});
