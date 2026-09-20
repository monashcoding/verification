/**
 * Load `.env` into process.env for local development.
 *
 * Import this *first* from every entry point, before anything that reads
 * `process.env` at module scope (db/index.ts, codes/generate.ts, …).
 *
 * Deliberately a no-op in production: the container never has a `.env` (it's in
 * .dockerignore, and the runtime stage only copies dist/ and drizzle/), so this
 * always throws ENOENT there and is swallowed. Dokploy's injected environment is
 * untouched either way — Node gives a real environment variable precedence over
 * a file entry, so a stray `.env` could not override prod config even if one
 * somehow existed.
 *
 * Without this, every `process.env.X ?? '<default>'` in the codebase silently
 * used its fallback locally. DATABASE_URL failed loudly; CODE_SECRET would not
 * have — it would just have generated discount codes that don't match prod's.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // No .env (production, CI, or a fresh clone) — the real environment is it.
}
