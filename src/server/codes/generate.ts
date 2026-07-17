import { createHmac } from 'node:crypto';

// Deterministic per-(card_number, event_id) code (§4). Derived via HMAC with a
// server secret so codes are NOT guessable from public data (a plain hash of a
// student ID would be). Same inputs always yield the same code, which makes
// provisioning idempotent and lets us regenerate a lost export without drift.

const CODE_SECRET = process.env.CODE_SECRET ?? 'dev-insecure-code-secret-change-me';
const CODE_PREFIX = process.env.CODE_PREFIX ?? 'MAC';
const CODE_BODY_LEN = 8;

// Crockford-ish base32 without ambiguous chars (no I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function toBase32(bytes: Buffer, length: number): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
      if (out.length === length) return out;
    }
  }
  return out;
}

/**
 * Generate the deterministic code for a member's roster card number at a given
 * event. Returns e.g. "MAC-7Q2K9F3M". If `cardNumber` is null (a roster row with
 * no student ID), we fall back to the roster id-less HMAC over the empty string,
 * which is still unique per event but callers should generally only provision
 * codes for rows that have a card number.
 */
export function generateCode(cardNumber: string | null, eventId: number): string {
  const material = `${cardNumber ?? ''}:${eventId}`;
  const digest = createHmac('sha256', CODE_SECRET).update(material).digest();
  return `${CODE_PREFIX}-${toBase32(digest, CODE_BODY_LEN)}`;
}
