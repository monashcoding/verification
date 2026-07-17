import { runDailyDiff } from './cron.js';

// Entry point for the daily-diff cron (§9 Trigger B). Wire this to a scheduled
// job (Dokploy cron / systemd timer): `tsx src/server/codes/run-daily-diff.ts`.
const results = await runDailyDiff();
const total = results.reduce(
  (acc, r) => ({ provisioned: acc.provisioned + r.provisioned, exported: acc.exported + r.exported }),
  { provisioned: 0, exported: 0 },
);
console.log(`[daily-diff] events=${results.length} provisioned=${total.provisioned} exported=${total.exported}`);
for (const r of results) {
  if (r.provisioned || r.exported) console.log(`  ${r.slug}: +${r.provisioned} codes, ${r.exported} exported`);
}
process.exit(0);
