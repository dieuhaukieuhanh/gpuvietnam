/**
 * Scan Vast + Clore marketplace for L40 / L40S / RTX 5090 (vs 2x4090 baseline).
 * Usage: node scripts/diag-gpu-market-scan.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function loadEnv() {
  const text = readFileSync(join(ROOT, '.env.local'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv();

const TARGETS = [
  { key: 'L40_1x', re: /\bl40\b(?!\s*s)/i, exclude: /l40s/i, numGpus: 1 },
  { key: 'L40S_1x', re: /l40\s*s|l40s/i, numGpus: 1 },
  // Ampere RTX A6000 only — not Quadro "Q RTX 6000", not Ada "6000Ada"
  {
    key: 'A6000_1x',
    re: /(?:rtx\s*)?a6000\b/i,
    exclude: /quadro|\bq\s*rtx|ada|6000ada|l40|5090|4090/i,
    numGpus: 1,
  },
  { key: 'RTX6000_ADA_1x', re: /6000\s*ada|rtx\s*6000\s*ada|ada\s*6000|6000ada/i, numGpus: 1 },
  { key: 'RTX5090_1x', re: /5090/i, numGpus: 1 },
  { key: 'RTX4090_1x', re: /4090/i, numGpus: 1 },
  { key: 'RTX4090_2x', re: /4090/i, numGpus: 2 },
  { key: 'RTX3090_1x', re: /3090/i, numGpus: 1 },
];

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - (idx - lo)) + sorted[hi] * (idx - lo);
}

function summarizePrices(prices) {
  const sorted = [...prices].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return {
    count: sorted.length,
    min: +sorted[0].toFixed(4),
    p25: +percentile(sorted, 0.25).toFixed(4),
    median: +percentile(sorted, 0.5).toFixed(4),
    p75: +percentile(sorted, 0.75).toFixed(4),
    max: +sorted[sorted.length - 1].toFixed(4),
  };
}

function matchTarget(gpuName, numGpus, target) {
  const name = String(gpuName ?? '');
  if (target.exclude && target.exclude.test(name)) return false;
  if (!target.re.test(name)) return false;
  if (target.numGpus != null && Number(numGpus) !== target.numGpus) return false;
  return true;
}

async function scanVast() {
  const key = process.env.VAST_AI_KEY || process.env.VAST_API_KEY;
  if (!key) return { error: 'missing VAST_AI_KEY' };

  const res = await fetch('https://console.vast.ai/api/v0/bundles/', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      verified: { eq: true },
      rentable: { eq: true },
      rented: { eq: false },
      order: [['dph_total', 'asc']],
      type: 'on-demand',
      limit: 5000,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: `HTTP ${res.status}`, detail: data };
  }

  const all = Array.isArray(data?.offers) ? data.offers : Array.isArray(data) ? data : [];

  const byTarget = {};
  for (const t of TARGETS) {
    const matched = all.filter((o) =>
      matchTarget(o.gpu_name ?? o.gpu_name_long ?? o.gpu_display_name, o.num_gpus ?? 1, t),
    );
    const prices = matched.map((o) => Number(o.dph_total ?? o.dph_base ?? o.price_per_hour ?? 0));
    const dlperfs = matched
      .map((o) => Number(o.dlperf ?? 0))
      .filter((n) => n > 0);
    const dlperfPerDollar = matched
      .map((o) => {
        const dph = Number(o.dph_total ?? o.dph_base ?? 0);
        const dl = Number(o.dlperf ?? 0);
        return dph > 0 && dl > 0 ? dl / dph : null;
      })
      .filter((n) => n != null);
    const vrams = matched
      .map((o) => Number(o.gpu_ram ?? 0) / 1024)
      .filter((n) => n > 0);
    byTarget[t.key] = {
      available: matched.length,
      priceUsdPerHr: summarizePrices(prices),
      dlperf: summarizePrices(dlperfs),
      dlperfPerUsd: summarizePrices(dlperfPerDollar),
      vramGbPerCard: summarizePrices(vrams),
      sample: matched.slice(0, 3).map((o) => ({
        id: o.id,
        gpu: o.gpu_name,
        num_gpus: o.num_gpus,
        dph: +(Number(o.dph_total ?? o.dph_base) || 0).toFixed(4),
        dlperf: o.dlperf != null ? +Number(o.dlperf).toFixed(1) : null,
        vramGb: o.gpu_ram != null ? +(Number(o.gpu_ram) / 1024).toFixed(1) : null,
        reliability: o.reliability2 ?? o.reliability,
        geo: o.geolocation ?? o.country,
      })),
    };
  }

  return {
    provider: 'vast',
    totalOffersScanned: all.length,
    byTarget,
  };
}

async function scanClore() {
  const key = process.env.CLORE_AI_KEY || process.env.CLORE_API_KEY;
  const headers = { Accept: 'application/json' };
  if (key) headers.auth = key;

  const res = await fetch('https://api.clore.ai/v1/marketplace', { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: `HTTP ${res.status}`, detail: data };
  }

  const servers = Array.isArray(data?.servers) ? data.servers : [];
  const available = servers.filter((s) => !s.rented);

  function gpuText(s) {
    const arr = Array.isArray(s.gpu_array) ? s.gpu_array.join(' ') : '';
    const specs = String(s.specs?.gpu ?? '');
    return `${arr} ${specs}`;
  }

  function numGpus(s) {
    if (Array.isArray(s.gpu_array) && s.gpu_array.length) return s.gpu_array.length;
    const m = String(s.specs?.gpu ?? '').match(/(\d+)\s*x/i);
    if (m) return Number(m[1]);
    return 1;
  }

  function usdPrice(s) {
    const p = s.price ?? {};
    const fromUsd = Number(p?.usd?.on_demand_usd);
    if (Number.isFinite(fromUsd) && fromUsd > 0) return fromUsd;
    const blockchain = Number(p?.on_demand?.['USD-Blockchain']);
    if (Number.isFinite(blockchain) && blockchain > 0) return blockchain;
    const onDemand = Number(p.on_demand_usd ?? p.usd ?? 0);
    if (Number.isFinite(onDemand) && onDemand > 0) return onDemand;
    return null;
  }

  const byTarget = {};
  for (const t of TARGETS) {
    const matched = available.filter((s) => matchTarget(gpuText(s), numGpus(s), t));
    const prices = matched.map(usdPrice).filter((n) => n != null);
    const reliabilities = matched
      .map((s) => Number(s.reliability ?? s.specs?.reliability ?? 0))
      .filter((n) => n > 0);
    byTarget[t.key] = {
      available: matched.length,
      withUsdPrice: prices.length,
      priceUsdPerHr: summarizePrices(prices),
      reliability: summarizePrices(reliabilities),
      sample: matched.slice(0, 5).map((s) => ({
        id: s.id,
        gpu: s.gpu_array ?? s.specs?.gpu,
        num_gpus: numGpus(s),
        price: s.price,
        reliability: s.reliability,
        cc: s.specs?.net?.cc,
      })),
    };
  }

  return {
    provider: 'clore',
    totalServers: servers.length,
    availableServers: available.length,
    byTarget,
  };
}

const [vast, clore] = await Promise.all([scanVast(), scanClore()]);
const report = {
  at: new Date().toISOString(),
  vast,
  clore,
};

mkdirSync(join(ROOT, 'tmp'), { recursive: true });
const out = join(ROOT, 'tmp', 'gpu-market-scan.json');
writeFileSync(out, JSON.stringify(report, null, 2));

function row(provider, key) {
  const t = provider?.byTarget?.[key];
  if (!t) return `${key}: n/a`;
  const p = t.priceUsdPerHr;
  const price = p
    ? `n=${p.count} min=$${p.min} med=$${p.median} p75=$${p.p75}`
    : 'no USD prices';
  return `${key}: avail=${t.available} | ${price}`;
}

console.log('=== VAST ===');
console.log('scanned:', vast.totalOffersScanned ?? vast.error);
for (const t of TARGETS) console.log(' ', row(vast, t.key));

console.log('\n=== CLORE ===');
console.log('available servers:', clore.availableServers ?? clore.error);
for (const t of TARGETS) console.log(' ', row(clore, t.key));

console.log('\nWrote', out);
