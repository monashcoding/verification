# Deploying to Dokploy

`mac-membership-verify` ships as a single app container (SPA + API) plus Postgres,
defined in [`docker-compose.yml`](../docker-compose.yml). This mirrors the rest of
the MAC Suite (spec §3): Dokploy compose stack on the Oracle VM.

## Prerequisites

- A DNS record for **`verify.monashcoding.com`** pointing at the Oracle VM.
  - The app **must** be served under `*.monashcoding.com`. mac-auth sets its
    session cookie on `.monashcoding.com` and trusts that origin — an off-domain
    host would need adding to mac-auth's `TRUSTED_ORIGINS` (avoid this).
- Dokploy running on the VM, with access to this GitHub repo.

## 1. Create the Compose service

In Dokploy:

1. **Create → Compose**, provider **GitHub**, repo `monashcoding/verification`,
   branch `main`, compose path `docker-compose.yml`.
2. Save. Don't deploy yet — set the environment first.

## 2. Environment variables (Dokploy → Environment)

| Variable | Required | Notes |
|----------|----------|-------|
| `CODE_SECRET` | **yes** | Long random string. Discount codes are derived from it; changing it later changes every code. Compose refuses to start without it. |
| `POSTGRES_PASSWORD` | recommended | Postgres password (also used in `DATABASE_URL`). Defaults to the project name if unset — set a real one in prod. |
| `DISCORD_WEBHOOK_URL` | optional | Where code batches are posted (§9). Unset → the cron just logs. |
| `AUTH_URL` | optional | Defaults to `https://auth.monashcoding.com`. |
| `JWT_AUDIENCE` | optional | Defaults to `mac-suite`. |
| `MAC_ADMIN_ROLES` | optional | Defaults to `exec,committee`. |
| `VITE_AUTH_URL` | optional | Build-time; baked into the SPA. Defaults to the prod auth URL. |

## 3. Domain

Add a domain in Dokploy: host `verify.monashcoding.com`, **container port `3000`**,
HTTPS on (Let's Encrypt). Dokploy's Traefik routes the domain to the app container.

## 4. Deploy

Hit **Deploy**. On container start the entrypoint applies Drizzle migrations
(`docker-entrypoint.sh` → `dist/server/db/migrate.js`) before serving, so the
schema is created/updated automatically. No manual migration step.

## 5. Auto-deploy on push

Dokploy → the service → **Deployments / Git → enable "Auto Deploy."** Dokploy
registers a webhook on the GitHub repo so every push to `main` triggers a rebuild
and redeploy.

If you'd rather wire it by hand: copy the service's **Webhook URL** from Dokploy
and add it under GitHub repo **Settings → Webhooks** (content type
`application/json`, event: push).

## 6. Daily-diff cron (§9 Trigger B)

Provisioning for newly-published events fires automatically (Trigger A, when an
event is created/activated via the admin API). The daily catch-up for members who
link *after* an event's first batch is a separate scheduled run:

Dokploy → **Schedules / Cron** → new task against the **app** service:

```
node dist/server/codes/run-daily-diff.js
```

Daily (e.g. `0 9 * * *`) is plenty — stragglers aren't urgent (§10).

## 7. Verify the deployment

```bash
# Health (no auth):
curl -s https://verify.monashcoding.com/api/health
# → {"ok":true,"service":"mac-membership-verify"}
```

Then a manual end-to-end: open `https://verify.monashcoding.com/`, sign in, and
confirm the account chooser appears (mac-auth `prompt=select_account`). Admin
routes require an exec/committee mac-auth token.
