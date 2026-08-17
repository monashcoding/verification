import { runDailyDiff } from './cron.js';

// Entry point for the daily-diff cron (§9 Trigger B). Wire this to a scheduled
// job (Dokploy cron / systemd timer): `tsx src/server/codes/run-daily-diff.ts`.
const { sync, retired, results } = await runDailyDiff();
if (!sync.configured) console.log('[daily-diff] humanitix sync skipped (HUMANITIX_API_KEY unset)');
else if (sync.error) console.error(`[daily-diff] humanitix sync failed: ${sync.error}`);
else console.log(`[daily-diff] synced humanitix: ${sync.created.length} new, ${sync.updated.length} refreshed`);
if (sync.created.length) console.log(`[daily-diff] new events: ${sync.created.join(', ')}`);
if (retired.length) console.log(`[daily-diff] retired past events: ${retired.join(', ')}`);
const total = results.reduce(
  (acc, r) => ({ provisioned: acc.provisioned + r.provisioned, exported: acc.exported + r.exported }),
  { provisioned: 0, exported: 0 },
);
console.log(`[daily-diff] events=${results.length} provisioned=${total.provisioned} exported=${total.exported}`);
for (const r of results) {
  if (r.provisioned || r.exported) console.log(`  ${r.slug}: +${r.provisioned} codes, ${r.exported} exported`);
}
process.exit(0);
