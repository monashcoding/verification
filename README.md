# mac-membership-verify

A verification gate MAC puts in front of Humanitix ticket links. It checks whether a visitor
is a current MAC member (via mac-auth login + the MSA membership roster) and either sends them
to Humanitix with a personal discount code pre-applied, or to the normal ticket link.

See `SPEC_mac_membership_verify.md` for the source of truth and `CLAUDE.md` for the rules that
are easy to get wrong. **This is not a Humanitix replacement and not a payments system.**

## Stack

React + Vite frontend, Express API, Postgres via Drizzle ORM, single container (Dokploy on the
Oracle VM). Matches the rest of the MAC Suite.

## Build status (per §12 build order)

- [x] **1. Roster import** — schema, admin upload route, safety gate, xlsx parsing.
- [x] **2. mac-auth integration** — real Better Auth flow: session-cookie sign-in → JWT → Bearer,
  EdDSA JWKS verification against `monashcoding/mac-auth` (`macUserId`/`roles`/`team` claims, `mac-suite` audience).
- [x] **3. Auto-apply link discovery** — confirmed `?discountcode={code}` (§8), `composeAutoApplyUrl`.
- [x] **4. Linking flow** — email auto-match, student-ID entry, DB rate limiting, skip, full §7 state machine.
- [x] **5. Code provisioning cron** — deterministic codes, CSV export, Discord ping, Triggers A & B.
- [x] **6. Event-specific verify page** — `/e/:slug` with interstitial + manual continue.
- [x] **7. Generic verify page** — `/` with active-events list.
- [x] **8. Events admin CRUD** — create/activate fires Trigger A.
- [x] **9. Manual review queue** — attempt-exhausted list + officer manual link.

## Getting started

```bash
npm install
cp .env.example .env          # point DATABASE_URL at your Postgres
npm run db:generate           # generate SQL migrations from the Drizzle schema
npm run db:migrate            # apply them
npm run dev                   # start the API on :3000
npm run dev:web               # start the Vite SPA on :5173 (proxies /api → :3000)
npm test                      # unit + integration tests (integration skip without a test DB)
npm run test:db:up            # throwaway Postgres on :55432 for the integration tests
npm run test:db:down          # stop it (tmpfs — nothing persists anyway)
npm run build                 # compile server + build SPA into dist/ (single container)
npm run cron:daily-diff       # Trigger B (§9) + retire past events — wire to a scheduled job
```

## Tests

Unit tests cover the pure logic (parser, safety gate, rate limit, code generation, CSV shape).
Integration tests (`*.db.test.ts`) run against a real Postgres, because the membership logic is
mostly SQL — a roster import silently orphaning every `member_link` was a bug no mock would have
caught. `npm run test:db:up` starts a disposable database on port 55432; without it those tests
skip rather than fail, so `npm test` works on a fresh clone.

The harness (`src/test/db.ts`) truncates tables between tests and refuses to run against any
database whose name doesn't end in `_test`, so it can't be pointed at a real one by accident.

Events whose date has passed are retired automatically (`active → false`) — by the daily cron,
and again whenever the admin events list is loaded. Nothing is deleted: the row, its codes and
the audit trail stay queryable, and the admin panel lists retired events under "past events".
Reads (`/e/:slug`, the generic list) also filter on the date, so an event stops being served the
moment it ends rather than at the next cron run. Manually-entered events with no dates are never
retired automatically.

The frontend lives in `web/` (React + Vite) and is served by Express from `dist/web/` in
production — one container serving SPA + API (§3).

### mac-auth

Integration follows [`monashcoding/mac-auth`](https://github.com/monashcoding/mac-auth): the SPA
POSTs `/api/auth/sign-in/social` → provider → callback sets a `.monashcoding.com` session
cookie → SPA GETs `/api/auth/token` for a JWT and sends it as `Authorization: Bearer`. The
backend (`src/server/auth/mac-auth.ts`) verifies it locally against the EdDSA JWKS, mirroring the
service's own `examples/verify.ts` (issuer `AUTH_URL`, audience `mac-suite`, canonical id
`macUserId`).

**Account chooser (§5):** mac-auth now sets `prompt=select_account` on its Google and Microsoft
providers (suite-wide), so the provider account chooser is forced at login — no silent auto-pick
of the wrong account. It only applies during an actual OAuth login; an existing MAC session is
reused untouched. The app additionally shows the signed-in account with a **"Not you? Switch
account"** control (`AccountBar`) for switching after the fact.

## Deployment

Single container (SPA + API) + Postgres via Dokploy — see
[`docs/deploy-dokploy.md`](docs/deploy-dokploy.md). Migrations apply automatically on container
start; auto-deploy triggers on push to `main`.

## Roster import (step 1)

Admin-only, gated by a mac-auth exec/admin role claim.

```bash
# Upload the MSA Clubs & Societies export (Members_*.xlsx):
curl -X POST http://localhost:3000/api/admin/roster/import \
  -H "Authorization: Bearer <mac-auth JWT>" \
  -F file=@Members_2026.xlsx

# Current roster visibility:
curl http://localhost:3000/api/admin/roster/summary \
  -H "Authorization: Bearer <mac-auth JWT>"
```

**Safety gate (§6):** an import whose `ENROLLED` count is zero, or less than half the current
`ENROLLED` count, is refused with HTTP 409 unless you re-submit with `-F override=true`. This
stops a wrong-sheet or half-downloaded file from silently gutting the membership base.

Each import replaces the roster snapshot wholesale under a new `import_batch_id`; prior batches
are kept queryable, never hard-deleted.

## Events & member codes (steps 5, 8)

Every enrolled member gets a **distinct discount code per event** (`member_event_codes`, keyed on
`roster_id` + `event_id`) — MAC's member pricing is set ad hoc per event, so a single global code
can't reproduce the right price everywhere. Officers never touch codes by hand; the admin panel
generates them and hands back a CSV.

**Auto-sync (primary path).** Set `HUMANITIX_API_KEY` (Humanitix account → Settings → API Keys)
and the org's live, upcoming events pull themselves in from the Humanitix **read-only** Public API —
no per-event URL entry. The sync runs on every `cron:daily-diff` and whenever an officer opens the
events admin. New live events are created internally (active, so the daily diff provisions their
codes with no click) and existing ones get their preview metadata — banner, description, venue,
dates — refreshed. A missing field in the Humanitix payload never blanks a value we already have, so
clearing a banner is a manual edit. If the key is unset or Humanitix is unreachable, the sync is
skipped, the admin says so, and everything else proceeds as normal.

This is the official `x-api-key` API used for *reading only* (event list + one event's details) —
not dashboard scripting, not order/ticket sync. Uploading each event's CSV into its **Promote →
Discounts → CSV upload** stays a manual step by design: re-verified against the v1.21.0 OpenAPI
spec, there is no discounts resource, and the only write endpoints are event create/update (name,
description, location, dates, keywords, classification) and ticket transfer/check-in.

**One list in the admin.** Because every live Humanitix event is synced into `events`, a live event
and its verify link are the same row — name, dates, `/e/slug`, code count, and **Download codes
CSV**. Manual entries are tagged `manual`; past events are retired server-side and collapse into
their own section.

The auto-apply link handed to verified members is `{event_url}?discountcode={code}` (§8).

**Student-ID rate limit (§7).** Failed student-ID lookups are throttled in the DB (survives page
reloads): **20 failed attempts, then a 1h cooldown** from the last attempt. The cap only exists to
stop scripted ID enumeration — a real member who mistypes effectively never hits it.
