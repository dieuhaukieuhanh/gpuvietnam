/**
 * Probe create_order on uptime >= 99% Clore hosts (Starter 3090).
 * Cancels on success. Usage: node scripts/diag-clore-gt99.mjs
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
const currency = 'USD-Blockchain';
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
    json = { raw: String(text).slice(0, 300) };
  }
  return { status: res.status, json };
}

function is3090(s) {
  if (s?.rented === true) return false;
  const arr = Array.isArray(s.gpu_array) ? s.gpu_array : [];
  const joined = (arr.join(' ') + ' ' + String(s?.specs?.gpu || '')).toLowerCase();
  if (!/3090/.test(joined) || /mixed/.test(joined)) return false;
  const count = Math.max(arr.length || 0, 1);
  return count === 1 || s.partial_gpu_rental === true;
}

await sleep(2000);
const market = await api('GET', '/marketplace');
const servers = Array.isArray(market.json?.servers) ? market.json.servers : [];
const gt99 = servers
  .filter((s) => is3090(s) && Number(s.reliability || 0) >= 0.99)
  .filter((s) => Number(s?.price?.on_demand?.[currency] || 0) > 0)
  .filter(
    (s) =>
      !Array.isArray(s.allowed_coins) ||
      s.allowed_coins.map(String).includes(currency),
  )
  .map((s) => ({
    id: s.id,
    daily: Number(s.price.on_demand[currency]),
    rel: Number(s.reliability),
  }))
  .sort((a, b) => a.daily - b.daily);

const report = {
  at: new Date().toISOString(),
  gt99Count: gt99.length,
  top: gt99.slice(0, 5),
  attempts: [],
};

for (const target of gt99.slice(0, 3)) {
  await sleep(6000);
  const body = {
    currency,
    image: IMAGE,
    renting_server: target.id,
    type: 'on-demand',
    ports: { '22': 'tcp', '8188': 'http' },
    ssh_password: 'GvDiagPass123A1',
    env: {
      COMFYUI_PORT: '8188',
      GPUVIETNAM_DISK_GB: '20',
      GPUVIETNAM_PACKAGE: 'starter',
      GPUVIETNAM_DIAG: 'gt99',
    },
  };
  const res = await api('POST', '/create_order', body);
  const oid = res.json?.order_id ?? res.json?.id ?? null;
  const row = {
    target,
    status: res.status,
    code: res.json?.code ?? null,
    error: res.json?.error ?? null,
    orderId: oid,
    keys: res.json && typeof res.json === 'object' ? Object.keys(res.json) : [],
  };

  if (oid || (res.status === 200 && Number(res.json?.code) === 0)) {
    await sleep(3000);
    const orders = await api('GET', '/my_orders');
    const list = Array.isArray(orders.json?.orders) ? orders.json.orders : [];
    const match = list.find(
      (o) => String(o.si ?? o.renting_server) === String(target.id),
    );
    row.recoveredId = match?.id ?? match?.order_id ?? null;
    const cancelId = oid || row.recoveredId;
    if (cancelId) {
      await sleep(1500);
      const c = await api('POST', '/cancel_order', { id: Number(cancelId) });
      row.cancel = { id: cancelId, status: c.status, code: c.json?.code ?? null };
    }
    report.attempts.push(row);
    break;
  }
  report.attempts.push(row);
}

mkdirSync('tmp', { recursive: true });
writeFileSync(join(ROOT, 'tmp/clore-gt99.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
