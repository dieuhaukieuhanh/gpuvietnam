/**
 * Smoke: send one P0-C ops alert email.
 *
 *   node scripts/ops-alert-smoke.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { opsAlert, resolveOpsAlertEmail } from '../src/lib/ops/alert-dispatcher.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(ROOT, '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    const k = t.slice(0, i).trim();
    if (process.env[k] == null) process.env[k] = v;
  }
}

const to = resolveOpsAlertEmail();
console.log('Sending smoke ops alert →', to);
const result = await opsAlert({
  event: 'smoke',
  severity: 'info',
  title: 'P0-C smoke test',
  details: {
    note: 'If you received this, ops email alerting works.',
    at: new Date().toISOString(),
  },
  dedupeKey: `smoke:${Date.now()}`,
});
console.log(result);
process.exit(result.sent ? 0 : 1);
