import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  uuid,
  unique,
} from 'drizzle-orm/pg-core';

// ── Enums ────────────────────────────────────────────────────────────────────

export const msaMembershipStatus = pgEnum('msa_membership_status', ['MSA+', 'Non-MSA+']);
export const enrollmentStatus = pgEnum('enrollment_status', ['ENROLLED', 'INACTIVE']);
export const linkedVia = pgEnum('linked_via', ['email_auto', 'student_id', 'manual_review']);

// ── roster (§4) ──────────────────────────────────────────────────────────────
// Imported wholesale from the MSA Clubs & Societies export on every upload.
// A snapshot, not appended to. Prior batches stay queryable via import_batch_id.
export const roster = pgTable('roster', {
  id: serial('id').primaryKey(),
  lastName: text('last_name'),
  firstName: text('first_name'),
  // Student ID. Kept as text — leading zeros matter and it is never arithmetic.
  cardNumber: text('card_number'),
  email: text('email'),
  msaMembershipStatus: msaMembershipStatus('msa_membership_status'),
  // NULL is allowed per spec (§4) — an unknown enrollment state.
  enrollmentStatus: enrollmentStatus('enrollment_status'),
  studyLocation: text('study_location'),
  purchaseDate: text('purchase_date'),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  importBatchId: uuid('import_batch_id').notNull(),
});

// ── events (§4) ──────────────────────────────────────────────────────────────
// Manually maintained. Only the link we send people to — no Humanitix sync.
export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  humanitixEventUrl: text('humanitix_event_url').notNull(),
  // Maps to the Humanitix event `_id` when the event was pulled from their API
  // (null for manually-entered events). Lets us reconcile the live list against
  // our internal rows without duplicating.
  humanitixEventId: text('humanitix_event_id').unique(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── member_links (§4) ────────────────────────────────────────────────────────
// One-time resolution of "which roster row is this Google/Microsoft account".
// After a row exists, every future visit is a single lookup on mac_user_id.
export const memberLinks = pgTable('member_links', {
  id: serial('id').primaryKey(),
  macUserId: text('mac_user_id').notNull().unique(),
  rosterId: integer('roster_id')
    .notNull()
    .references(() => roster.id),
  linkedVia: linkedVia('linked_via').notNull(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── member_event_codes (§4) ──────────────────────────────────────────────────
// Per-event, per-roster-row. Keyed on roster_id + event_id, NOT mac_user_id —
// generation is independent of whether the account has linked yet.
export const memberEventCodes = pgTable(
  'member_event_codes',
  {
    id: serial('id').primaryKey(),
    rosterId: integer('roster_id')
      .notNull()
      .references(() => roster.id),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id),
    code: text('code').notNull(),
    quantity: integer('quantity').notNull().default(1),
    maxUsePerOrder: integer('max_use_per_order').notNull().default(1),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    // null means not yet included in an export batch.
    exportedAt: timestamp('exported_at', { withTimezone: true }),
  },
  (t) => ({
    rosterEventUnique: unique('member_event_codes_roster_event_unique').on(t.rosterId, t.eventId),
  }),
);

// ── roster_link_attempts (§4) ────────────────────────────────────────────────
// Rate limiting for the student-ID field. Persisted (not session-scoped) so a
// page reload does not reset the counter. Cap 5, 24h cooldown from last attempt.
export const rosterLinkAttempts = pgTable('roster_link_attempts', {
  macUserId: text('mac_user_id').primaryKey(),
  failedCount: integer('failed_count').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── audit_log (§4) ───────────────────────────────────────────────────────────
// Append-only. Log roster imports, link creation, failed-attempt escalations,
// code-batch exports.
export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  // null for system/cron actions.
  actorMacUserId: text('actor_mac_user_id'),
  action: text('action').notNull(),
  detail: jsonb('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RosterRow = typeof roster.$inferSelect;
export type NewRosterRow = typeof roster.$inferInsert;
export type Event = typeof events.$inferSelect;
export type MemberLink = typeof memberLinks.$inferSelect;
export type MemberEventCode = typeof memberEventCodes.$inferSelect;
