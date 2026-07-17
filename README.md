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
- [x] **2. mac-auth integration** — JWKS JWT verification + admin gating (`src/server/auth`).
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
npm test                      # unit tests: parser, safety gate, rate limit, codes (no DB)
npm run build                 # compile server + build SPA into dist/ (single container)
npm run cron:daily-diff       # Trigger B (§9) — wire to a scheduled job
```

The frontend lives in `web/` (React + Vite) and is served by Express from `dist/web/` in
production — one container serving SPA + API (§3). Login forces the account chooser
(`prompt=select_account`, §5) in `web/src/auth.ts`.

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
