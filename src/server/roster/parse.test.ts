import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseRosterWorkbook, normalizeCardNumber, RosterParseError } from './parse.js';

const BATCH = '00000000-0000-0000-0000-000000000000';

function buildWorkbook(rows: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Members');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const HEADER = [
  'Last name', 'First name', 'Title', 'Card number', 'Email address',
  'Membership Status', 'Purchase date', 'Renewal date', 'Study location', 'Status',
];

describe('normalizeCardNumber', () => {
  it('preserves leading zeros and strips excel apostrophe/whitespace', () => {
    expect(normalizeCardNumber("  '01234567 ")).toBe('01234567');
    expect(normalizeCardNumber('')).toBeNull();
    expect(normalizeCardNumber(33445566)).toBe('33445566');
  });
});

describe('parseRosterWorkbook', () => {
  it('maps the real export columns onto roster rows', () => {
    const wb = buildWorkbook([
      HEADER,
      ['Smith', 'Ada', 'Ms', '31234567', 'ADA@Example.com', 'MSA+', '2026-01-01', '2027-01-01', 'Clayton', 'ENROLLED'],
      ['Doe', 'John', 'Mr', '39999999', 'john@x.com', 'Non-MSA+', '2026-02-01', '', 'Caulfield', 'INACTIVE'],
    ]);
    const rows = parseRosterWorkbook(wb, BATCH);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      lastName: 'Smith', firstName: 'Ada', cardNumber: '31234567',
      email: 'ada@example.com', msaMembershipStatus: 'MSA+',
      enrollmentStatus: 'ENROLLED', studyLocation: 'Clayton', importBatchId: BATCH,
    });
    expect(rows[1]!.enrollmentStatus).toBe('INACTIVE');
    expect(rows[1]!.msaMembershipStatus).toBe('Non-MSA+');
  });

  it('is tolerant of header casing/whitespace variations', () => {
    const wb = buildWorkbook([
      ['LAST NAME', 'first  name', 'Card Number', 'Email', 'Status'],
      ['Lovelace', 'Ada', '30000001', 'a@b.com', 'Enrolled'],
    ]);
    const rows = parseRosterWorkbook(wb, BATCH);
    expect(rows[0]!.enrollmentStatus).toBe('ENROLLED');
    expect(rows[0]!.cardNumber).toBe('30000001');
  });

  it('leaves enrollment_status null when the value is unrecognized', () => {
    const wb = buildWorkbook([HEADER, ['X', 'Y', '', '30000002', 'y@x.com', 'MSA+', '', '', '', 'PENDING']]);
    expect(parseRosterWorkbook(wb, BATCH)[0]!.enrollmentStatus).toBeNull();
  });

  it('skips fully blank rows', () => {
    const wb = buildWorkbook([
      HEADER,
      ['Real', 'Person', '', '30000003', 'r@p.com', 'MSA+', '', '', '', 'ENROLLED'],
      ['', '', '', '', '', '', '', '', '', ''],
    ]);
    expect(parseRosterWorkbook(wb, BATCH)).toHaveLength(1);
  });

  it('throws when required columns are absent (wrong sheet)', () => {
    const wb = buildWorkbook([['Foo', 'Bar'], ['1', '2']]);
    expect(() => parseRosterWorkbook(wb, BATCH)).toThrow(RosterParseError);
  });

  it('throws when headers exist but there are no member rows', () => {
    const wb = buildWorkbook([HEADER]);
    expect(() => parseRosterWorkbook(wb, BATCH)).toThrow(RosterParseError);
  });
});
