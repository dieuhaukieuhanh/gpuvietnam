/**
 * Force Clore-only rent smoke for rtx3090 (Starter), then cancel.
 * Usage: node scripts/diag-clore-force-rent.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
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
    env[t.slice(0, i).trim()] = v;
    if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = v;
  }
  return env;
}

loadEnv();

const { CloreClient } = await import(
  pathToFileURL(join(process.cwd(), 'src/lib/gpu/providers/clore/clore-client.js')).href
);

const client = new CloreClient();
const report = {
  at: new Date().toISOString(),
  configured: client.isConfigured(),
  currency: client.currency,
};

try {
  const ranked = await client.findRankedOffers('rtx3090', 'starter');
  report.rankedCount = ranked.length;
  report.top3 = ranked.slice(0, 3).map((o) => ({
    id: o.offerId,
    price: o.pricePerHour,
    region: o.region,
    reason: o.reason,
  }));

  if (!ranked.length) {
    report.error = 'No ranked offers after filters';
  } else {
    const raw = await client.createInstance({
      gpuLine: 'rtx3090',
      plan: 'starter',
      env: { GPUVIETNAM_DIAG: 'force-rent' },
    });
    report.created = {
      id: raw?.id ?? raw?.order_id ?? null,
      keys: raw && typeof raw === 'object' ? Object.keys(raw) : [],
      status: raw?.status ?? null,
      renting_server: raw?.renting_server ?? raw?.si ?? null,
    };
    const orderId = String(raw?.order_id ?? raw?.id ?? '');
    if (orderId) {
      // honor rate limit
      await new Promise((r) => setTimeout(r, 5500));
      report.cancel = await client.destroyInstance(orderId);
    }
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.stack = error instanceof Error ? error.stack : null;
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/clore-force-rent.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
