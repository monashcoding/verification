import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://mac_membership_verify:mac_membership_verify@localhost:5432/mac_membership_verify';

// Single shared connection pool for the app.
const client = postgres(connectionString);

export const db = drizzle(client, { schema });
export { schema };
