#!/bin/sh
set -e

# Apply any pending Drizzle migrations before the server accepts traffic. The DB
# is guaranteed up by compose's depends_on: service_healthy, so this is a plain
# run rather than a retry loop.
echo "[entrypoint] applying migrations…"
node dist/server/db/migrate.js

echo "[entrypoint] starting server…"
exec node dist/server/index.js
