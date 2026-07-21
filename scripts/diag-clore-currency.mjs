/**
 * Follow-up: which Clore hosts allow USD-Blockchain, then optional rent+cancel.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

function loadEnv() {
  /** @type {Record<string, string>} */
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
  }
  return env;
}

const env = loadEnv();
const key = (env.CLORE_API_KEY || env.CLORE_AI_KEY || '').trim();
const BASE = 'https://api.clore.ai/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clore(method, path, body) {
  const headers = { Accept: 'application/json', auth: key };
  /** @type {RequestInit} */
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text.slice(0, 400);
  }
  return { status: res.status, payload };
}

function currencies(s) {
  const on = s?.price?.on_demand;
  if (on && typeof on === 'object') {
    return Object.keys(on).filter((k) => Number(on[k]) > 0);
  }
  return [];
}

function dailyUsd(s) {
  const u = Number(s?.price?.usd?.on_demand_usd);
  if (u > 0) return u;
  const c = Number(s?.price?.on_demand?.['USD-Blockchain']);
  if (c > 0) return c;
  return 0;
}

function is4090_1x(s) {
  if (s?.rented === true) return false;
  const arr = Array.isArray(s?.gpu_array) ? s.gpu_array : [];
  const specsGpu = String(s?.specs?.gpu ?? '');
  const joined = (arr.join(' ') + ' ' + specsGpu).toLowerCase();
  if (!/4090/.test(joined) || /mixed/.test(joined)) return false;
  const m = specsGpu.match(/(\d+)\s*x/i);
  const fromSpecs = m ? Number(m[1]) : 0;
  const host = Math.max(arr.length || 0, fromSpecs || 0, 1);
  if (host !== 1 && s?.partial_gpu_rental !== true) return false;
  return dailyUsd(s) > 0;
}

const market = await clore('GET', '/marketplace');
const servers = Array.isArray(market.payload?.servers) ? market.payload.servers : [];
const cands = servers.filter(is4090_1x);
const withUsd = cands
  .filter((s) => currencies(s).includes('USD-Blockchain'))
  .sort((a, b) => dailyUsd(a) - dailyUsd(b));

const currencyHistogram = {};
for (const s of cands) {
  const keyList = currencies(s).sort().join(',') || '(none)';
  currencyHistogram[keyList] = (currencyHistogram[keyList] || 0) + 1;
}

/** @type {Record<string, unknown>} */
const report = {
  at: new Date().toISOString(),
  total4090_1x: cands.length,
  withUsdBlockchain: withUsd.length,
  currencyHistogram,
  sampleNoUsd: cands.slice(0, 5).map((s) => ({
    id: s.id,
    dailyUsd: dailyUsd(s),
    currencies: currencies(s),
    on_demand: s.price?.on_demand ?? null,
    usd: s.price?.usd ?? null,
  })),
  cheapestUsdAllowed: withUsd.slice(0, 5).map((s) => ({
    id: s.id,
    dailyUsd: dailyUsd(s),
    currencies: currencies(s),
    region: s.specs?.net?.cc,
  })),
};

if (withUsd.length) {
  await sleep(5500);
  const target = withUsd[0];
  const body = {
    type: 'on-demand',
    currency: 'USD-Blockchain',
    image: 'dieuhaukieuhanh/gpuvietnam-comfyui:v1',
    renting_server: target.id,
    ports: { '22': 'tcp', '8080': 'http' },
    env: { GPUVIETNAM_DIAG: 'step01-usd' },
    autossh_entrypoint: true,
  };
  const res = await clore('POST', '/create_order', body);
  report.rentUsdAllowed = {
    serverId: target.id,
    dailyUsd: dailyUsd(target),
    status: res.status,
    code: res.payload?.code ?? null,
    error: res.payload?.error ?? null,
    orderId: res.payload?.order_id ?? res.payload?.id ?? null,
    keys: res.payload && typeof res.payload === 'object' ? Object.keys(res.payload) : [],
  };
  if (report.rentUsdAllowed.orderId) {
    await sleep(5500);
    const cancel = await clore('POST', '/cancel_order', {
      id: Number(report.rentUsdAllowed.orderId),
    });
    report.rentUsdAllowed.cancel = {
      status: cancel.status,
      code: cancel.payload?.code ?? null,
      error: cancel.payload?.error ?? null,
    };
  }
} else {
  report.rentUsdAllowed = {
    skipped: true,
    reason: 'No 4090_1x host advertises USD-Blockchain in price.on_demand',
  };
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/clore-step01-currency.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
