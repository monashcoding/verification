import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { describe } from 'vitest';
import { db } from '../server/db/index.js';

/**
 * Harness for tests that need a real Postgres (see docker-compose.test.yml).
 *
 * The link-resolution and code-provisioning paths are all SQL — the bug where a
 * roster import orphaned every member_link was invisible to pure unit tests, so
 * those paths get exercised against an actual database rather than a mock.
 *
 * These tests drive the app's own `db` singleton; vitest.config.ts points its
 * DATABASE_URL at the throwaway test database. They skip rather than fail when
 * no test database is running, so `npm test` works on a fresh clone without
 * Docker.
 */

// Guard rail: truncating tables is destructive and DATABASE_URL may well point at
// something real on a developer's machine. Only ever touch a database whose name
// says it is disposable.
export function assertDisposable(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run destructive tests against database "${name}" — its name must end in _test. ` +
        'Set TEST_DATABASE_URL to a throwaway database.',
    );
  }
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL unset — vitest.config.ts should provide the test database.');
assertDisposable(url);

async function probe(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export const dbAvailable = await probe();

if (dbAvailable) {
  // Schema comes from the real migrations, so a migration that is wrong or
  // missing fails the tests instead of being papered over by a schema push.
  await migrate(db, { migrationsFolder: './drizzle' });
} else {
  console.warn(
    `\n[test] No test database at ${url.replace(/:[^:@]*@/, ':***@')} — skipping integration tests.` +
      '\n[test] Start one with: npm run test:db:up\n',
  );
}

/** `describe` that skips the whole block when no test database is reachable. */
export const describeDb = dbAvailable ? describe : describe.skip;

/**
 * Empty every table and restart identity sequences, so each test starts from a
 * known state and row ids are predictable.
 */
export async function resetDb(): Promise<void> {
  if (!dbAvailable) return;
  await db.execute(
    sql`truncate table audit_log, member_event_codes, member_links, roster_link_attempts, events, roster restart identity cascade`,
  );
}
