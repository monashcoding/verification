# SPEC — mac-membership-verify

## 1. Purpose

MAC events on Humanitix have two prices — member and non-member — with no way to enforce
who's entitled to which. Right now it's an honour system: anyone can pick the member ticket.
This service closes that gap **without switching ticketing platforms and without building a
payments system**, by giving verified MAC members a personal Humanitix discount code and
routing every marketing link through a verification step first.

**One-sentence justification:** members currently get the discount on trust alone; this
service checks trust against the real MSA membership roster and hands out a working discount
code only to people who pass, while leaving everything else about how MAC runs events on
Humanitix untouched.

## 2. What this is not

- Not a Humanitix replacement. Humanitix stays the ticketing platform, payment processor, and
  the thing that actually issues tickets.
- Not a mac-auth change. mac-auth's job stays "prove this is a real Google/Microsoft account
  and tell you their email." Membership is not an identity fact — it's looked up locally here,
  same reasoning as the committee roster in mac-auth's own roster/claims extension.
- Not a full Humanitix sync. No poll-and-reconcile of tickets or orders. This is a
  **pre-purchase gate**, not post-purchase verification — much smaller surface than the
  hackathon platform's Humanitix integration.

## 3. Stack

Matches the rest of the MAC Suite: React + Vite frontend, Express API, Postgres via Drizzle
ORM, single container serving SPA + API, Dokploy compose stack on the Oracle VM, trusted
automatically as `*.monashcoding.com` under mac-auth. `POSTGRES_USER` /
`POSTGRES_PASSWORD` / `POSTGRES_DB` all match the project name (`mac_membership_verify`).

## 4. Data model

### `roster`
Imported from the MSA Clubs & Societies export (`Members_*.xlsx`). Re-imported wholesale on
every upload — this table is a snapshot, not appended to.

```
id, last_name, first_name, card_number (student id), email, msa_membership_status
  enum('MSA+','Non-MSA+'), enrollment_status enum('ENROLLED','INACTIVE',NULL),
  study_location, purchase_date, imported_at, import_batch_id
```

Only rows with `enrollment_status = 'ENROLLED'` count as a current member for linking and
code-generation purposes. `INACTIVE` rows are kept for visibility, not deleted.

### `member_links`
The one-time resolution of "which roster row is this Google/Microsoft account."

```
id, mac_user_id UNIQUE, roster_id (fk roster.id), linked_via
  enum('email_auto','student_id','manual_review'), linked_at
```

Once a row exists here, every future visit is a single lookup on `mac_user_id`. No re-matching
on email, ever — this is what makes "logs in with a personal Google account forever" work.

### `member_event_codes`
**Per-event, not global.** MAC's member/non-member pricing is set ad hoc per event with no
consistent ratio or discount formula, so a single Humanitix global discount code (one
discount rule, applied uniformly everywhere) can't reproduce the right price across events.
Each member gets a distinct code per event instead — same operational shape as the
per-event CSV discount upload Humanitix already supports natively.

Keyed by roster row + event, **not** by `mac_user_id` — generation is independent of whether
someone has linked their account yet. The cron job provisions a code for every `ENROLLED`
roster row against every event that needs one, so it's ready the moment they do link.

```
id, roster_id (fk roster.id), event_id (fk events.id), UNIQUE(roster_id, event_id),
  code, quantity default 1, max_use_per_order default 1, generated_at,
  exported_at (nullable — null means not yet in an upload batch)
```

`code` is deterministic from `card_number` (student id) and `event_id` combined — not from
anything guessable off public data. Quantity 1 / max-use-per-order 1 is enough now that a
code is scoped to a single event and a single member — no need for a generous yearly pool,
since there's nothing to reuse across events anymore.

### `roster_link_attempts`
Rate limiting for the student-ID entry field, persisted (not session-scoped) so it survives a
page reload.

```
mac_user_id UNIQUE, failed_count, last_attempt_at
```

Cap: 5 failed attempts, then drop to the "not linked" state (see §6) rather than a hard error.
Counter resets 24h after `last_attempt_at` — long enough to stop rapid guessing, short enough
that a genuine mistyper isn't locked out for the rest of the year.

### `events`
Manually maintained. This service has no reason to know about Humanitix events beyond having
a link to send people to.

```
id, name, slug UNIQUE, humanitix_event_url, active boolean default true, created_at
```

### `audit_log`
Append-only, same pattern as the rest of the suite.

```
id, actor_mac_user_id (nullable — null for system/cron actions), action, detail jsonb,
  created_at
```
Log: roster imports, link creation (and via what method), failed-attempt escalations,
code-batch exports.

## 5. mac-auth integration

Standard JWT verification via JWKS, same as CRM and hackathon platform. Pull `email` from the
verified token. **Force `prompt=select_account` on the OAuth redirect for this app
specifically** — people commonly have multiple Google sessions cached, and silently reusing
whichever one is active is a bigger source of false "not linked" states in practice than actual
roster mismatches. Don't rely on mac-auth defaults here; override explicitly.

No changes to mac-auth's schema, JWT claims, or JWKS. This service is a consumer, not a
contributor, to identity.

## 6. Roster import

Admin-only upload route (xlsx, matching the real export format — see actual columns in
`Members_*.xlsx`: `Last name, First name, Title, Card number, Email address,
Membership Status, Purchase date, Renewal date, Study location, Status`).

**Safety gate, same shape as mac-auth's roster sync**: refuse an import that would result in
fewer than half the current `ENROLLED` count, or an empty roster, unless an explicit override
flag is passed. A malformed export (wrong sheet, half-downloaded file) should never silently
wipe out most of the membership base.

Each import replaces the `roster` table wholesale (new `import_batch_id`), not an incremental
diff — the source file is already a full snapshot, no reason to reconcile row-by-row against
the last one.

## 7. Linking flow

Two entry points into the same underlying resolution logic:

**Event-specific**: `verify.monashcoding.com/e/{event-slug}` — what marketing posts link to
instead of the raw Humanitix URL. Resolves membership, then redirects to that one event.

**Generic**: `verify.monashcoding.com/` — for a member checking their status any time, not
tied to a specific event. Shows a list of active events with buttons instead of redirecting.

### Resolution logic (both entry points)

1. Not logged in → mac-auth login (forced account chooser)
2. Logged in → check `member_links` for this `mac_user_id`
   - **Found** → look up their code via `roster_id`. This is the fast path — invisible to
     the ~10% whose login email happens to match their roster email too, since step 3 below
     auto-creates this link on first visit.
   - **Not found** → try automatic email match: does `roster.email` (ENROLLED only) match
     the mac-auth email? If yes, auto-create the link (`linked_via = 'email_auto'`), done.
   - **Still not found** (expected for ~90% given most people log in with a personal
     account rather than their student one) → show the student ID field, described next.

### Student ID step (not a fallback — the primary path for most people)

- One field: "Enter your student ID to link your membership." Framed as a normal step, not
  an error state.
- **Skippable**, clearly, next to the field: "Skip — I'm not a member." Skipping writes
  nothing to the DB — no state to persist, which is also why the prompt naturally reappears
  on the next visit without any special "re-offer" logic.
- Normalize input before matching: strip whitespace, handle leading zeros.
- Match against `roster.card_number` where `enrollment_status = 'ENROLLED'`.
  - Match → create link (`linked_via = 'student_id'`), done.
  - No match → increment `roster_link_attempts.failed_count`, generic message ("check the
    number and try again") — don't reveal whether the ID doesn't exist, exists but isn't
    ENROLLED, or matched a different student. Under the cap: allow retry. At the cap: same
    as skip — drop to "not linked" for this session, replace the field with a quiet
    "think this is wrong? contact us" line (manual review, now opt-in and genuinely rare
    rather than automatic).

### Outcome (both entry points, after resolution)

Codes are now per-event, so "does this member have a code" is answered per event, not once
for the whole account. On the event-specific entry point this is a single lookup on
`(roster_id, event_id)`; on the generic entry point, each event in the list is checked and
rendered independently — a member might have a working code for one active event and be
"pending" for another that was published more recently.

- **Linked, code exists for this event** → compose the Humanitix auto-apply link (see §8)
  and either redirect (event-specific entry) or show it against that event (generic entry).
- **Linked, no code yet for this event** → "You're verified — your code for this event is
  being set up, check back soon." This is expected to happen briefly for any newly published
  event before its first export batch runs — don't dead-end someone who's a genuine member
  but arrived before provisioning caught up.
- **Not linked (skipped, or exhausted attempts)** → plain, unmodified Humanitix link. No
  dead end, no error tone — just the normal ticket price.

### Event-specific entry UX

Show a brief interstitial ("You're verified! Redirecting you to tickets…") with the redirect
firing automatically **and** a manual "Continue to tickets" button as a fallback, in case a
popup/redirect blocker interferes. Don't silently bounce with zero confirmation — people should
understand why they landed somewhere other than the marketing link they clicked.

## 8. Humanitix auto-apply link

Humanitix supports a shareable per-code link that lands a buyer on the event page with the
discount pre-applied — no manual code entry. **Confirmed empirically**: the query parameter
is `discountcode`, e.g. `https://events.humanitix.com/{event-slug}?discountcode={code}`.

Because codes are now per-event (see §4 — ad hoc pricing ruled out the global-scope
approach), there's no cross-event transfer to worry about, and none to test for: a code
created under one event's `Promote > Discounts` page is only ever meant to work on that
event's URL. Link composition is simply
`{events.humanitix_event_url}?discountcode={member's code for that event}`.

**Do not use the "Global discount codes" menu** (`Promote > Global discount codes` at the
account level, not inside an event) — that feature exists for a single discount rule shared
across many events, which only makes sense if the discount is consistent (e.g. a flat % off
everywhere). MAC's pricing isn't consistent event to event, so codes must be created and
uploaded through each individual event's own `Promote > Discounts > CSV upload`, same as the
per-person unique-code pattern Humanitix documents for membership discounts.

## 9. Code provisioning cron

Two triggers now, not one, since a code needs both a member *and* an event to exist:

**A. New event published** (an `events` row is created/activated) — this is the primary,
higher-volume trigger:
1. Generate a `member_event_codes` row for every currently `ENROLLED` roster row against
   this event (deterministic code from `card_number` + `event_id`, quantity 1,
   max-use-per-order 1).
2. Export the full batch as a single Humanitix CSV for that one event.
3. Ping the Discord bot with the file, naming the event so the officer knows which event's
   `Promote > Discounts > CSV upload` page to paste it into.
4. Mark the batch `exported_at = now()` (optimistic — same reasoning as before: no way to
   confirm the officer actually completed the dashboard upload, acceptable given the ping
   lands right when they're looking at it).

**B. Daily diff, for events still open** — catches members who link *after* an event's
initial batch already went out (new signup, or someone who joins mid-sale-period):
1. For each `events` row still `active`, find `ENROLLED` roster rows with no
   `member_event_codes` row for that event yet.
2. If any exist, treat the same as a mini version of trigger A — but only bother the officer
   once there's a meaningful batch, not for a single straggler (see §10).

**Lapsed members (ENROLLED → INACTIVE): do nothing.** Passive by design — their existing
codes for events they already have one for keep working. No revocation logic, because a code
can't actually be disabled remotely once it's live on Humanitix (no write API) — "revoking"
in our DB wouldn't touch the real thing without yet another manual dashboard edit, so it
isn't worth building. Since codes are quantity-1 now anyway, a lapsed member's exposure is
capped at whatever events they already had a code for, not an ongoing yearly allowance.

## 10. Upload cadence

Unlike the global-code design, cadence now genuinely depends on event publishing, not just
roster changes — **an event with member pricing needs its code batch uploaded before or
around when ticket sales open**, or early buyers just don't get the discount until an
officer catches up. That's back to being closer to the original per-event framing from
earlier in this project, now that the pricing model forces it.

Practically: trigger A above should fire as part of publishing any event with member
pricing — worth adding to whatever checklist already exists for launching an event (ticket
types, dates, description), the same way "check for a pending roster batch" would have been
under the global-code design. Trigger B (mid-sale stragglers) doesn't need urgency — batch
size ≥ 5 or oldest pending code >1 week, whichever comes first, is enough given the
worst case is just "this one member pays full price for this one event," same fallback as
always.

## 11. Admin surfaces

- **Roster upload** (§6) — exec/admin gated via mac-auth JWT role claim.
- **Events CRUD** (§4 `events` table) — name, slug, Humanitix URL, active toggle. Exec/admin
  gated. This is the only place event data lives; nothing here talks to Humanitix directly.
- **Manual review queue** — the rare case where someone's exhausted their student-ID attempts
  and asked to be reviewed. Simple list, officer manually creates a `member_links` row
  (`linked_via = 'manual_review'`) if they can confirm the person's membership by other means.

## 12. Build order

1. **Roster import** — schema, upload route, safety gate, xlsx parsing against the real
   column layout. This unblocks everything else and is independently useful (visibility into
   current membership) even before the rest exists.
2. **mac-auth integration** — JWT verification middleware, forced account-chooser login.
3. **Auto-apply link discovery** (§8) — do this early; it's a 10-minute manual step that
   de-risks an assumption the rest of the redirect flow depends on.
4. **Linking flow** — email auto-match, student ID entry + rate limiting, skip handling, the
   full state machine in §7.
5. **Code provisioning cron** — generation + export batching + Discord bot ping.
6. **Event-specific verify page** (`/e/:slug`) — the one marketing actually links to.
7. **Generic verify page** (`/`) — code lookup + list of active events for direct visits.
8. **Events admin CRUD.**
9. **Manual review queue** (last — genuinely rare given student ID is now the primary path).

## 13. What NOT to do

- Don't add membership status to mac-auth's JWT or database. It's derived, local, and
  single-consumer for now.
- Don't build revocation against Humanitix codes. There's no write API; a DB flag here
  wouldn't reach the real thing anyway.
- Don't re-match on email every visit once a link exists. Resolve once, remember forever.
- Don't treat "not a member" as an error state anywhere in the UI. It's a normal, common
  outcome — dead-ending or shaming it will just generate support DMs.
- Don't build a full Humanitix ticket/order sync. This is pre-purchase, not post-purchase —
  resist scope creep toward the hackathon platform's poll-and-reconcile machinery.
- Don't reveal *why* a student ID match failed (wrong number vs. not ENROLLED vs. not found).
  One generic message for all three.
- Don't skip the auto-apply link discovery step and guess the query parameter — verify it
  against a real test code first. (Already done — see §8, `discountcode`.)
- Don't use Humanitix's account-level "Global discount codes" feature. It applies one
  discount rule across every event it's scoped to, which breaks the moment two events have
  a different member/non-member price gap — which is the normal case here, not an edge
  case. Codes are per-event by design (§4, §8).
- Don't build browser automation against the Humanitix dashboard to remove the manual upload
  step. Confirmed no API exists for this; scripting the dashboard UI is fragile, hard to debug
  for a future committee, and risks the account that runs live ticket sales. The two-minute
  manual upload, triggered by a bot ping, is the intended design — not a stopgap.

## 14. Future extensions (do not build now)

- Membership card PWA will need the same "is this a current member" check. Rather than
  duplicating the CSV import and `ENROLLED` filtering logic, expose a small internal lookup
  (`GET /membership-status?email=`) once that project actually needs it — same seam pattern
  as the CRM's `ReplySource` interface. Not built until there's a real second consumer.
- If Humanitix ever ships a discount-code API or a private/partner API becomes available on
  request, the provisioning cron's export step could push directly instead of generating a
  CSV for manual upload. Worth a support email to Humanitix at some point, low priority.
