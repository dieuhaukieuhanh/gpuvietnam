/**
 * Scan RTX 5090 with platform hard filters + uptime floors 99.8% / 99.9%.
 * Usage: node scripts/diag-rtx5090-uptime-scan.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeVastOffer,
  normalizeCloreOffer,
  passesOfferHardFilters,
  selectWorkstationOffers,
} from '../src/lib/gpu/offer-selection.js';
import { resolvePackageSpec, VAST_OFFER_SANITY } from '../src/lib/gpu/gpu-config.js';
import { classifyCloreServerForLine } from '../src/lib/gpu/providers/clore/clore-client.js';

const ROOT = process.cwd();
for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
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

const plan = 'studio';
const gpuLine = 'rtx5090_1x';
const spec = resolvePackageSpec(plan, gpuLine);
const criteria = {
  minHostDiskGb: spec.minHostDiskGb,
  numGpus: spec.numGpus,
  minVramGb: spec.minVramGb,
  minVramExclusive: spec.minVramExclusive === true,
};

function summarize(prices) {
  const s = prices.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const pct = (p) => {
    const idx = (s.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? s[lo] : s[lo] * (1 - (idx - lo)) + s[hi] * (idx - lo);
  };
  return {
    n: s.length,
    min: +s[0].toFixed(4),
    p25: +pct(0.25).toFixed(4),
    median: +pct(0.5).toFixed(4),
    p75: +pct(0.75).toFixed(4),
    max: +s[s.length - 1].toFixed(4),
  };
}

function applyVastSanity(offers) {
  const floor = VAST_OFFER_SANITY.minDphTotalByLine.rtx5090_1x;
  let pool = offers.filter((o) => o.pricePerHour >= floor);
  pool = pool.filter((o) => {
    if (!VAST_OFFER_SANITY.requirePositiveDlperf) return true;
    if (!o.raw || !('dlperf' in o.raw)) return true;
    const rawDl = Number(o.raw.dlperf);
    return !(Number.isFinite(rawDl) && rawDl <= 0);
  });
  const prices = pool.map((o) => o.pricePerHour).sort((a, b) => a - b);
  if (prices.length >= 3) {
    const mid = prices[Math.floor(prices.length / 2)];
    const cut = mid * VAST_OFFER_SANITY.medianPriceFloorRatio;
    pool = pool.filter((o) => o.pricePerHour >= cut);
  }
  return pool;
}

function report(offers, minUptime) {
  const hard = offers.filter((o) => passesOfferHardFilters(o, criteria));
  const up = hard.filter((o) => o.uptimePercent >= minUptime);
  const ranked = selectWorkstationOffers(up, {
    plan,
    gpuLine,
    minUptimePercent: minUptime,
  });
  return {
    minUptime,
    afterHardFilters: hard.length,
    afterUptime: up.length,
    priceUsdPerHour: summarize(up.map((o) => o.pricePerHour)),
    afterSelectTop: ranked.length,
    selectPriceUsdPerHour: summarize(ranked.map((r) => r.pricePerHour)),
    cheapestSample: up
      .slice()
      .sort((a, b) => a.pricePerHour - b.pricePerHour)
      .slice(0, 5)
      .map((o) => ({
        id: o.offerId,
        usdPerHour: +o.pricePerHour.toFixed(4),
        uptime: +o.uptimePercent.toFixed(3),
        pingMs: Math.round(o.pingMs),
        diskGb: Math.round(o.diskGb),
        region: o.region,
      })),
  };
}

async function fetchVast() {
  const key = process.env.VAST_AI_KEY || process.env.VAST_API_KEY;
  const res = await fetch('https://console.vast.ai/api/v0/bundles/', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      gpu_name: { in: ['RTX 5090'] },
      num_gpus: { eq: 1 },
      gpu_ram: { gt: 30 * 1024 },
      verified: { eq: true },
      rentable: { eq: true },
      rented: { eq: false },
      type: 'on-demand',
      limit: 500,
      order: [['dph_total', 'asc']],
    }),
  });
  const data = await res.json();
  const all = Array.isArray(data?.offers) ? data.offers : [];
  return all.map((o) => normalizeVastOffer(o)).filter(Boolean);
}

async function fetchClore() {
  const key = (process.env.CLORE_AI_KEY || process.env.CLORE_API_KEY || '').trim();
  const res = await fetch('https://api.clore.ai/v1/marketplace', {
    headers: { Accept: 'application/json', auth: key },
  });
  const data = await res.json();
  const servers = Array.isArray(data?.servers)
    ? data.servers
    : Array.isArray(data?.data)
      ? data.data
      : [];
  const out = [];
  for (const s of servers) {
    const classified = classifyCloreServerForLine(s, gpuLine);
    if (!classified) continue;
    const n = normalizeCloreOffer(s, classified);
    if (n) out.push(n);
  }
  return out;
}

const [vast, clore] = await Promise.all([fetchVast(), fetchClore()]);
const vastSanity = applyVastSanity(vast);

const result = {
  scannedAt: new Date().toISOString(),
  package: 'studio / rtx5090_1x',
  criteria: {
    ...criteria,
    maxPingMs: 250,
    minMaxDurationDays: 3,
    minInetDownMbps: 100,
    minRamGb: 16,
    minCudaVersion: 11.0,
    vastSanityFloorUsd: VAST_OFFER_SANITY.minDphTotalByLine.rtx5090_1x,
  },
  vast: {
    normalized: vast.length,
    afterSanity: vastSanity.length,
    'uptime>=99.8': report(vastSanity, 99.8),
    'uptime>=99.9': report(vastSanity, 99.9),
  },
  clore: {
    normalized: clore.length,
    'uptime>=99.8': report(clore, 99.8),
    'uptime>=99.9': report(clore, 99.9),
  },
};

mkdirSync(join(ROOT, 'tmp'), { recursive: true });
writeFileSync(join(ROOT, 'tmp', 'rtx5090-uptime-scan.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
