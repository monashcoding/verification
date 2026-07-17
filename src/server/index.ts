import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { attachUser } from './auth/mac-auth.js';
import { rosterRouter } from './routes/roster.js';
import { verifyRouter } from './routes/verify.js';
import { eventsAdminRouter } from './routes/events-admin.js';
import { reviewAdminRouter } from './routes/review-admin.js';

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

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`mac-membership-verify listening on :${port}`);
  });
}

export { app };
