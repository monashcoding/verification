import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Must be imported before the routers: patches Express 4 so errors thrown from
// async route handlers reach the error middleware instead of becoming unhandled
// rejections (which, on Node's default, crash the process → Traefik 502s).
import 'express-async-errors';
import express from 'express';
import { attachUser } from './auth/mac-auth.js';
import { rosterRouter } from './routes/roster.js';
import { verifyRouter } from './routes/verify.js';
import { eventsAdminRouter } from './routes/events-admin.js';
import { reviewAdminRouter } from './routes/review-admin.js';
import { humanitixAdminRouter } from './routes/humanitix-admin.js';

const app = express();
app.use(express.json());

// Populate req.macUser from a mac-auth JWT when present (never rejects here).
app.use(attachUser);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'mac-membership-verify' });
});

// Public-facing verification flow (§7).
app.use('/api/verify', verifyRouter);

// Admin surfaces (§11). Roster is build-order step 1.
app.use('/api/admin/roster', rosterRouter);
app.use('/api/admin/events', eventsAdminRouter);
app.use('/api/admin/review', reviewAdminRouter);
app.use('/api/admin/humanitix', humanitixAdminRouter);

// Serve the built SPA (§3, single container serving SPA + API). Compiled server
// lives at dist/server/, the SPA build at dist/web/.
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
app.use(express.static(webDir));
// SPA fallback for client-side routes (/, /e/:slug) — but never for /api.
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(webDir, 'index.html'));
});

// Central error handler so route handlers can `throw`.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'internal_error' });
});

// Belt-and-suspenders: never let a stray rejection take the whole service down.
// express-async-errors should already route request errors to the middleware;
// this catches anything outside the request lifecycle (timers, etc.).
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`mac-membership-verify listening on :${port}`);
  });
}

export { app };
