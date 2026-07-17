# CLAUDE.md — mac-membership-verify

Read `SPEC_mac_membership_verify.md` first. It is the source of truth. This file is the short
version plus the rules that are easy to get wrong.

## What this is

A verification gate MAC puts in front of Humanitix ticket links. Marketing posts a link to
*this* app instead of the raw Humanitix event page. The app checks whether the visitor is a
current MAC member (via mac-auth login + the MSA membership roster), and either sends them to
Humanitix with a personal discount code pre-applied, or sends them to the normal ticket link.

**It is not a Humanitix replacement and not a payments system.** Humanitix still handles
money, tickets, and the actual checkout. If you find yourself building order tracking or
ticket sync, stop — that's the hackathon platform's job on a different project, not this one.

## The one-sentence justification

Right now anyone can pick the cheaper member ticket on Humanitix — it's an honour system.
This app checks that trust against a real membership export before handing out a working
discount code, without switching ticketing platforms or touching payments.

## Non-negotiables

- **Don't touch mac-auth.** No new claims, no schema changes, no membership data anywhere
  near its JWT or database. It proves identity; this app looks up membership locally.
- **Force the Google/Microsoft account chooser** on login for this app specifically
  (`prompt=select_account` or equivalent) — most false "not a member" outcomes come from the
  wrong cached account being used silently, not real roster mismatches.
- **Resolve the account-to-roster link once, in `member_links`, and never re-check by email
  after that.** The whole point is that someone can keep using a personal Google account
  forever after linking once.
- **Student ID entry is the primary path, not a fallback.** ~90% of members won't email-match
  automatically. Design the UI and copy for that reality — it's a normal step, not an error
  recovery screen.
- **Skipping writes nothing to the database.** That's what makes the prompt naturally
  reappear on someone's next visit without any special "re-offer" logic — don't add a
  `skipped` flag or any other persisted state for it.
- **Never reveal which part of a student-ID check failed** (wrong number / not ENROLLED /
  not found at all). One generic retry message covers all three.
- **Rate-limit student ID attempts in the database, not in session/client state** — a page
  reload must not reset the counter. 5 attempts, 24h cooldown from the last attempt.
- **Passive on lapsed membership.** `ENROLLED → INACTIVE` does not trigger any revocation
  logic. There's no way to pull back a code that's already live on Humanitix without a manual
  dashboard edit, so don't build machinery that pretends otherwise.
- **Codes are per-event, not global.** MAC's member pricing is set ad hoc per event with no
  consistent discount ratio, so a single global discount code can't reproduce the right
  price everywhere. Every member gets a distinct code per event
  (`member_event_codes`, keyed on `roster_id` + `event_id`). Don't consolidate this back
  into one code per member — it was tried and doesn't fit the pricing model.
- **Don't use Humanitix's "Global discount codes" feature.** That's for one discount rule
  shared across events, which only works if pricing is consistent — it isn't here. Codes go
  through each individual event's own `Promote > Discounts > CSV upload`.
- **The auto-apply query parameter is confirmed: `discountcode`.** Link format is
  `{event_url}?discountcode={code}`. No further discovery needed — this was verified against
  a real test code.
- **No browser automation against the Humanitix dashboard.** The manual CSV upload is the
  intended design, not a gap to script around — there's no API for this, and scripting a UI
  Humanitix can change any time is exactly the kind of fragile, undebuggable-by-a-future-
  committee-member thing this whole suite is trying to avoid.
- **Don't hard-delete roster rows, links, or codes.** Import replaces the roster snapshot
  wholesale, but keep prior batches queryable via `import_batch_id` rather than deleting.

## Roster import safety gate

Same shape as mac-auth's committee roster sync: refuse an import that would drop the
`ENROLLED` count by more than half, or to zero, unless an explicit override is passed. A bad
file (wrong sheet, partial download) should never silently gut the membership base.

## Build order

See §12 of the spec. Short version: roster import first (useful on its own), then mac-auth
wiring, then the Humanitix auto-apply link discovery (empirical, do this before building
redirect logic against it), then the linking flow, then the provisioning cron, then the two
verify pages, then admin CRUD, then the manual review queue last.
