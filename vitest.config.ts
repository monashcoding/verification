import { defineConfig } from 'vitest/config';

// Explicit config so Vitest does not auto-discover web/vite.config.ts as a second
// project and run the server tests twice.
//
// Two kinds of test live alongside the server code: pure unit tests, and
// integration tests that need a real Postgres (src/test/db.ts, which skips them
// when none is running — `npm run test:db:up` starts one). DATABASE_URL is forced
// to the throwaway test database here, before src/server/db/index.ts reads it at
// import time, so a stray .env can never aim the tests at a real database.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://mac_membership_verify:mac_membership_verify@localhost:55432/mac_membership_verify_test';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: { DATABASE_URL: TEST_DATABASE_URL },
    // The integration tests share one database, so they must not interleave.
    fileParallelism: false,
  },
});
