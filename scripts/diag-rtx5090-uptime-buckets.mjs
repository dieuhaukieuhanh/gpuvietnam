import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeVastOffer,
  normalizeCloreOffer,
  passesOfferHardFilters,
} from '../src/lib/gpu/offer-selection.js';
import { resolvePackageSpec } from '../src/lib/gpu/gpu-config.js';
import { classifyCloreServerForLine, resolveClorePricePerHour, cloreServerAcceptsCurrency } from '../src/lib/gpu/providers/clore/clore-client.js';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
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

const spec = resolvePackageSpec('studio', 'rtx5090_1x');
const criteria = {
  minHostDiskGb: spec.minHostDiskGb,
  numGpus: spec.numGpus,
  minVramGb: spec.minVramGb,
  minVramExclusive: true,
};

function sum(arr) {
  const s = arr.map((o) => o.pricePerHour).sort((a, b) => a - b);
  if (!s.length) return null;
  return {
    n: s.length,
    min: +s[0].toFixed(3),
    med: +s[Math.floor(s.length / 2)].toFixed(3),
    p75: +s[Math.min(s.length - 1, Math.floor(s.length * 0.75))].toFixed(3),
    max: +s[s.length - 1].toFixed(3),
  };
}

const vastKey = process.env.VAST_AI_KEY;
const vres = await fetch('https://console.vast.ai/api/v0/bundles/', {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${vastKey}`,
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
const vdata = await vres.json();
const vast = (vdata.offers || []).map(normalizeVastOffer).filter(Boolean);
const vhard = vast.filter((o) => passesOfferHardFilters(o, criteria));

const ckey = (process.env.CLORE_AI_KEY || '').trim();
const cres = await fetch('https://api.clore.ai/v1/marketplace', {
  headers: { Accept: 'application/json', auth: ckey },
});
const cdata = await cres.json();
const servers = cdata.servers || cdata.data || [];
const clore = [];
let failClass = 0;
const currency = process.env.CLORE_CURRENCY || 'USD-Blockchain';
for (const s of servers) {
  if (s.rented === true) continue;
  const c = classifyCloreServerForLine(s, 'rtx5090_1x');
  if (!c) {
    failClass += 1;
    continue;
  }
  if (!cloreServerAcceptsCurrency(s, currency)) continue;
  const pricePerHour = resolveClorePricePerHour(s, c);
  if (!(pricePerHour > 0)) continue;
  const n = normalizeCloreOffer(s, {
    numGpus: c.numGpus,
    gpuType: c.gpuType,
    pricePerHour,
    hostGpuCount: c.hostGpuCount,
  });
  if (n) clore.push(n);
}
const chard = clore.filter((o) => passesOfferHardFilters(o, criteria));

const buckets = [98, 99, 99.5, 99.8, 99.9];
const out = {
  scannedAt: new Date().toISOString(),
  criteria,
  vast: {
    normalized: vast.length,
    hard: vhard.length,
    buckets: Object.fromEntries(buckets.map((u) => [`>=${u}`, sum(vhard.filter((o) => o.uptimePercent >= u))])),
    sample998: vhard
      .filter((o) => o.uptimePercent >= 99.8)
      .sort((a, b) => a.pricePerHour - b.pricePerHour)
      .slice(0, 5)
      .map((o) => ({
        id: o.offerId,
        usd: +o.pricePerHour.toFixed(3),
        up: +o.uptimePercent.toFixed(3),
        ping: Math.round(o.pingMs),
        region: o.region,
      })),
  },
  clore: {
    servers: servers.length,
    normalized: clore.length,
    failClass,
    hard: chard.length,
    buckets: Object.fromEntries(buckets.map((u) => [`>=${u}`, sum(chard.filter((o) => o.uptimePercent >= u))])),
    beforeHard998: clore
      .filter((o) => o.uptimePercent >= 99.8)
      .slice(0, 8)
      .map((o) => ({
        id: o.offerId,
        usd: +o.pricePerHour.toFixed(3),
        up: +o.uptimePercent.toFixed(3),
        disk: o.diskGb,
        vram: o.vramGb,
        ping: Math.round(o.pingMs),
        rentable: o.rentable,
      })),
  },
};

writeFileSync(join('tmp', 'rtx5090-uptime-buckets.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
