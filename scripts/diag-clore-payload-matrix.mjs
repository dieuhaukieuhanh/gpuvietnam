/**
 * A/B create_order payload matrix for code-1 diagnosis.
 * Cancels on success. Usage: node scripts/diag-clore-payload-matrix.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
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

const key = (process.env.CLORE_API_KEY || process.env.CLORE_AI_KEY || '').trim();
const currency = process.env.CLORE_CURRENCY || 'USD-Blockchain';
const IMAGE = 'dieuhaukieuhanh/gpuvietnam-comfyui:v1';
const BASE = 'https://api.clore.ai/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const init = { method, headers: { Accept: 'application/json', auth: key } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: String(text).slice(0, 400) };
  }
  return { status: res.status, json };
}

function acceptsUsd(s) {
  const allowed = Array.isArray(s.allowed_coins) ? s.allowed_coins.map(String) : [];
  if (allowed.length && !allowed.includes(currency)) return false;
  const amount = Number(s?.price?.on_demand?.[currency]);
  return Number.isFinite(amount) && amount > 0;
}

function is3090(s) {
  if (s?.rented === true) return false;
  const arr = Array.isArray(s.gpu_array) ? s.gpu_array : [];
  const joined = (arr.join(' ') + ' ' + String(s?.specs?.gpu || '')).toLowerCase();
  if (!/3090/.test(joined) || /mixed/.test(joined)) return false;
  const count = Math.max(arr.length || 0, 1);
  return count === 1 || s.partial_gpu_rental === true;
}

await sleep(3000);
const market = await api('GET', '/marketplace');
const servers = Array.isArray(market.json?.servers) ? market.json.servers : [];
const cands = servers
  .filter((s) => is3090(s) && acceptsUsd(s))
  .map((s) => ({
    id: s.id,
    daily: Number(s.price.on_demand[currency]),
    rel: Number(s.reliability || 0),
  }))
  .filter((s) => s.daily > 0)
  .sort((a, b) => a.daily - b.daily);

const target = cands.find((c) => c.rel < 0.95) || cands[0];
const report = {
  at: new Date().toISOString(),
  currency,
  target,
  candCount: cands.length,
  attempts: [],
};

if (!target) {
  mkdirSync('tmp', { recursive: true });
  writeFileSync(join(ROOT, 'tmp/clore-payload-matrix.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

const ssh = 'GvDiagPass123A1';
const variants = [
  {
    name: 'minimal',
    body: {
      currency,
      image: IMAGE,
      renting_server: target.id,
      type: 'on-demand',
      ports: { '22': 'tcp', '8188': 'http' },
      ssh_password: ssh,
    },
  },
  {
    name: 'with_required_price',
    body: {
      currency,
      image: IMAGE,
      renting_server: target.id,
      type: 'on-demand',
      required_price: target.daily,
      ports: { '22': 'tcp', '8188': 'http' },
      ssh_password: ssh,
    },
  },
  {
    name: 'no_autossh_app_env',
    body: {
      currency,
      image: IMAGE,
      renting_server: target.id,
      type: 'on-demand',
      required_price: target.daily,
      ports: { '22': 'tcp', '8188': 'http' },
      ssh_password: ssh,
      env: {
        COMFYUI_PORT: '8188',
        GPUVIETNAM_DISK_GB: '20',
        GPUVIETNAM_PACKAGE: 'starter',
      },
    },
  },
  {
    name: 'autossh_true',
    body: {
      currency,
      image: IMAGE,
      renting_server: target.id,
      type: 'on-demand',
      required_price: target.daily,
      ports: { '22': 'tcp', '8188': 'http' },
      ssh_password: ssh,
      autossh_entrypoint: true,
    },
  },
  {
    name: 'cuda_minimal',
    body: {
      currency,
      image: 'nvidia/cuda:12.8.0-base-ubuntu22.04',
      renting_server: target.id,
      type: 'on-demand',
      required_price: target.daily,
      ports: { '22': 'tcp', '8188': 'http' },
      ssh_password: ssh,
    },
  },
];

for (const v of variants) {
  await sleep(6000);
  const res = await api('POST', '/create_order', v.body);
  const oid = res.json?.order_id ?? res.json?.id ?? null;
  const row = {
    name: v.name,
    status: res.status,
    code: res.json?.code ?? null,
    error: res.json?.error ?? null,
    orderId: oid,
    keys: res.json && typeof res.json === 'object' ? Object.keys(res.json) : [],
  };
  report.attempts.push(row);
  if (oid) {
    await sleep(6000);
    const c = await api('POST', '/cancel_order', { id: Number(oid) });
    row.cancel = { status: c.status, code: c.json?.code ?? null };
    break;
  }
  if (String(res.json?.error || '').includes('already-rented')) break;
}

mkdirSync('tmp', { recursive: true });
writeFileSync(join(ROOT, 'tmp/clore-payload-matrix.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
