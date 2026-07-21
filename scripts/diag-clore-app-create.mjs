/**
 * Simulate app CloreClient.createInstance (Starter / rtx3090), then cancel.
 * Usage: node scripts/diag-clore-app-create.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

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
  const k = t.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = v;
}

process.env.GPU_CLORE_ONLY = 'true';

const { CloreClient } = await import(
  pathToFileURL(join(process.cwd(), 'src/lib/gpu/providers/clore/clore-client.js')).href
);

const client = new CloreClient();
const report = { at: new Date().toISOString(), currency: client.currency };

try {
  const ranked = await client.findRankedOffers('rtx3090', 'starter');
  report.rankedCount = ranked.length;
  report.ranked = ranked.slice(0, 5).map((o) => ({
    id: o.offerId,
    uptime: o.uptimePercent,
    price: o.pricePerHour,
    region: o.region,
    group: o.uptimeGroup,
  }));

  const raw = await client.createInstance({
    gpuLine: 'rtx3090',
    plan: 'starter',
    label: 'diag-app-create',
    env: { GPUVIETNAM_DIAG: 'app-create' },
  });

  report.created = {
    id: raw?.order_id ?? raw?.id ?? null,
    si: raw?.si ?? raw?.renting_server ?? null,
    keys: raw && typeof raw === 'object' ? Object.keys(raw) : [],
  };

  const oid = String(raw?.order_id ?? raw?.id ?? '');
  if (oid) {
    await new Promise((r) => setTimeout(r, 6000));
    report.cancel = await client.destroyInstance(oid);
  }
} catch (e) {
  report.error = e instanceof Error ? e.message : String(e);
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/clore-app-create.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
