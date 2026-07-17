import * as XLSX from 'xlsx';
import type { NewRosterRow } from '../db/schema.js';

// Real MSA Clubs & Societies export columns (§6):
//   Last name, First name, Title, Card number, Email address,
//   Membership Status, Purchase date, Renewal date, Study location, Status
//
// Header matching is case/whitespace-insensitive so a minor export tweak
// (e.g. "Card Number" vs "Card number") does not silently drop a column.

export class RosterParseError extends Error {}

const HEADER_ALIASES: Record<keyof ParsedColumns, string[]> = {
  lastName: ['last name'],
  firstName: ['first name'],
  cardNumber: ['card number'],
  email: ['email address', 'email'],
  membershipStatus: ['membership status'],
  purchaseDate: ['purchase date'],
  studyLocation: ['study location'],
  status: ['status'],
};

interface ParsedColumns {
  lastName: string;
  firstName: string;
  cardNumber: string;
  email: string;
  membershipStatus: string;
  purchaseDate: string;
  studyLocation: string;
  status: string;
}

function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Normalize a student ID: trim whitespace, drop a leading apostrophe (Excel
 *  text-guard) but preserve leading zeros. Empty → null. */
export function normalizeCardNumber(raw: unknown): string | null {
  const v = String(raw ?? '').trim().replace(/^'/, '');
  return v.length ? v : null;
}

function mapMembershipStatus(raw: unknown): 'MSA+' | 'Non-MSA+' | null {
  const v = norm(raw);
  if (!v) return null;
  if (v.includes('non')) return 'Non-MSA+';
  if (v.includes('msa')) return 'MSA+';
  return null;
}

function mapEnrollmentStatus(raw: unknown): 'ENROLLED' | 'INACTIVE' | null {
  const v = norm(raw);
  if (!v) return null;
  if (v === 'enrolled') return 'ENROLLED';
  if (v === 'inactive') return 'INACTIVE';
  return null;
}

function textOrNull(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  return v.length ? v : null;
}

/**
 * Parse an MSA export workbook into roster rows (without import_batch_id, which
 * the import service stamps). Throws RosterParseError on structural problems —
 * a wrong sheet or a half-downloaded file should fail loudly, never silently.
 */
export function parseRosterWorkbook(buffer: Buffer, importBatchId: string): NewRosterRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    throw new RosterParseError(`Could not read the file as a spreadsheet: ${(err as Error).message}`);
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new RosterParseError('The workbook has no sheets.');
  const sheet = workbook.Sheets[sheetName]!;

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false });
  if (rows.length === 0) throw new RosterParseError('The sheet is empty.');

  // Locate the header row (first row that carries the required columns).
  const headerRowIndex = rows.findIndex((r) => {
    const cells = r.map(norm);
    return HEADER_ALIASES.lastName.some((a) => cells.includes(a)) &&
      HEADER_ALIASES.cardNumber.some((a) => cells.includes(a)) &&
      HEADER_ALIASES.status.some((a) => cells.includes(a));
  });
  if (headerRowIndex === -1) {
    throw new RosterParseError(
      'Could not find the expected columns (Last name, Card number, Status). ' +
        'Is this the MSA members export, and the right sheet?',
    );
  }

  const header = rows[headerRowIndex]!.map(norm);
  const colIndex: Partial<Record<keyof ParsedColumns, number>> = {};
  for (const key of Object.keys(HEADER_ALIASES) as (keyof ParsedColumns)[]) {
    const idx = header.findIndex((h) => HEADER_ALIASES[key].includes(h));
    if (idx !== -1) colIndex[key] = idx;
  }

  const out: NewRosterRow[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const get = (key: keyof ParsedColumns): unknown =>
      colIndex[key] === undefined ? undefined : r[colIndex[key]!];

    // Skip fully blank rows.
    const cardNumber = normalizeCardNumber(get('cardNumber'));
    const email = textOrNull(get('email'));
    const lastName = textOrNull(get('lastName'));
    const firstName = textOrNull(get('firstName'));
    if (!cardNumber && !email && !lastName && !firstName) continue;

    out.push({
      lastName,
      firstName,
      cardNumber,
      email: email?.toLowerCase() ?? null,
      msaMembershipStatus: mapMembershipStatus(get('membershipStatus')),
      enrollmentStatus: mapEnrollmentStatus(get('status')),
      studyLocation: textOrNull(get('studyLocation')),
      purchaseDate: textOrNull(get('purchaseDate')),
      importBatchId,
    });
  }

  if (out.length === 0) {
    throw new RosterParseError('The sheet has headers but no member rows.');
  }
  return out;
}
