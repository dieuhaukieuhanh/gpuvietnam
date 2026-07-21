/**
 * Diagnose systemic Clore create_order code-1 (no cancel needed if rent fails).
 * Usage: node scripts/diag-clore-code1-now.mjs [--rent]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const RENT = process.argv.includes('--rent');
const BASE = 'https://api.clore.ai/v1';
const IMAGE = 'dieuhaukieuhanh/gpuvietnam-comfyui:v1';
const SAFE_IMAGE = 'nvidia/cuda:12.8.0-base-ubuntu22.04';

function loadEnv() {
  const text = readFileSync(join(ROOT, '.env.local'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
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
}

loadEnv();
const key = (process.env.CLORE_API_KEY || process.env.CLORE_AI_KEY || '').trim();
const currency = process.env.CLORE_CURRENCY || 'USD-Blockchain';

async function api(method, path, body) {
  const init = {
    method,
    headers: { Accept: 'application/json', auth: key },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const started = Date.now();
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, ms: Date.now() - started, json };
}

function acceptsUsd(server) {
  const allowed = Array.isArray(server.allowed_coins) ? server.allowed_coins.map(String) : [];
  if (allowed.length && !allowed.includes(currency)) return false;
  const onDemand = server?.price?.on_demand || {};
  const amount = Number(onDemand[currency]);
  return Number.isFinite(amount) && amount > 0;
}

function is3090x1(server) {
  const arr = Array.isArray(server.gpu_array) ? server.gpu_array : [];
  const joined = (arr.join(' ') + ' ' + String(server?.specs?.gpu || '')).toLowerCase();
  if (!/3090/.test(joined) || /mixed/.test(joined)) return false;
  const count = Math.max(arr.length || 0, Number(server?.specs?.gpu_count) || 0, 1);
  return count === 1 || server.partial_gpu_rental === true;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const report = {
  at: new Date().toISOString(),
  rentMode: RENT,
  currency,
  keyLen: key.length,
};

const wallets = await api('GET', '/wallets');
report.wallets = {
  status: wallets.status,
  code: wallets.json?.code,
  balances: Array.isArray(wallets.json?.wallets)
    ? wallets.json.wallets.map((w) => ({
        currency: w.currency || w.name,
        balance: w.balance,
      }))
    : wallets.json,
};

const orders = await api('GET', '/my_orders');
const orderList = Array.isArray(orders.json?.orders)
  ? orders.json.orders
  : Array.isArray(orders.json)
    ? orders.json
    : [];
report.my_orders = {
  status: orders.status,
  code: orders.json?.code,
  count: orderList.length,
  sample: orderList.slice(0, 5).map((o) => ({
    id: o.id ?? o.order_id,
    si: o.si ?? o.renting_server,
    image: o.image,
    online: o.online,
  })),
};

const market = await api('GET', '/marketplace');
const servers = Array.isArray(market.json?.servers) ? market.json.servers : [];
const candidates = servers
  .filter((s) => s && s.rented !== true && is3090x1(s) && acceptsUsd(s))
  .map((s) => ({
    id: s.id,
    daily: Number(s?.price?.on_demand?.[currency]),
    allowed: s.allowed_coins,
    region: s.region || s.country,
    reliability: s.reliability ?? s.uptime,
    gpu: Array.isArray(s.gpu_array) ? s.gpu_array.join(',') : s?.specs?.gpu,
  }))
  .filter((s) => s.daily > 0)
  .sort((a, b) => a.daily - b.daily);

report.marketplace = {
  status: market.status,
  total: servers.length,
  usd3090: candidates.length,
  cheapest: candidates.slice(0, 5),
};

if (!RENT) {
  report.note = 'Pass --rent to probe create_order variants (cancels on success).';
  mkdirSync('tmp', { recursive: true });
  writeFileSync(join(ROOT, 'tmp/clore-code1-now.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const target = candidates[0];
if (!target) {
  report.error = 'No USD-accepting 3090 candidate';
  writeFileSync(join(ROOT, 'tmp/clore-code1-now.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

report.target = target;
await sleep(6000);

const sshPassword = 'GvDiagPass1!';
const variants = [
  {
    name: 'app_with_required_price',
    body: {
      currency,
      image: IMAGE,
      renting_server: target.id,
      required_price: target.daily,
      type: 'on-demand',
      ports: { '22': 'tcp', '8188': 'http' },
      ssh_password: sshPassword,
      autossh_entrypoint: true,
      env: { GPUVIETNAM_DIAG: 'code1-now' },
    },
  },
  {
    name: 'app_no_required_price',
    body: {
      currency,
      image: IMAGE,
      renting_server: target.id,
      type: 'on-demand',
      ports: { '22': 'tcp', '8188': 'http' },
      ssh_password: sshPassword,
      autossh_entrypoint: true,
    },
  },
  {
    name: 'safe_cuda_with_required_price',
    body: {
      currency,
      image: SAFE_IMAGE,
      renting_server: target.id,
      required_price: target.daily,
      type: 'on-demand',
      ports: { '22': 'tcp', '8188': 'http' },
      ssh_password: sshPassword,
      autossh_entrypoint: true,
    },
  },
];

report.attempts = [];
for (const variant of variants) {
  await sleep(6000);
  const res = await api('POST', '/create_order', variant.body);
  const oid = res.json?.order_id ?? res.json?.id ?? null;
  report.attempts.push({
    name: variant.name,
    status: res.status,
    ms: res.ms,
    code: res.json?.code ?? null,
    error: res.json?.error ?? null,
    orderId: oid,
    keys: res.json && typeof res.json === 'object' ? Object.keys(res.json) : [],
  });
  if (oid) {
    await sleep(6000);
    const cancel = await api('POST', '/cancel_order', { id: Number(oid) });
    report.attempts[report.attempts.length - 1].cancel = {
      status: cancel.status,
      code: cancel.json?.code ?? null,
    };
    break;
  }
}

mkdirSync('tmp', { recursive: true });
writeFileSync(join(ROOT, 'tmp/clore-code1-now.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
