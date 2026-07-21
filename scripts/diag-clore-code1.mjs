/**
 * Diagnose Clore create_order code 1 with app-like payloads.
 * Usage: node scripts/diag-clore-code1.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BASE = 'https://api.clore.ai/v1';
const IMAGE = 'dieuhaukieuhanh/gpuvietnam-comfyui:v1';

function loadEnvLocal() {
  const text = readFileSync(join(ROOT, '.env.local'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomPassword() {
  return 'GpuVn' + Math.random().toString(36).slice(2, 10) + 'A1!';
}

async function api(key, method, path, body) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      auth: key,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

loadEnvLocal();
const key = (process.env.CLORE_API_KEY || process.env.CLORE_AI_KEY || '').trim();
if (!key) {
  console.error('Missing CLORE API key');
  process.exit(1);
}

const orders = await api(key, 'GET', '/my_orders');
console.log(
  'orders',
  orders.status,
  orders.payload?.code,
  'count',
  (orders.payload?.orders || []).length,
);

const wallets = await api(key, 'GET', '/wallets');
console.log(
  'wallets',
  (wallets.payload?.wallets || []).map((w) => ({
    c: w.currency || w.name,
    b: w.balance,
  })),
);

await sleep(1200);
const mkt = await api(key, 'GET', '/marketplace');
const servers = mkt.payload?.servers || [];
const usd = servers.filter((s) => {
  if (s.rented) return false;
  const daily = Number(s?.price?.on_demand?.['USD-Blockchain'] || 0);
  if (!(daily > 0)) return false;
  const gpu = String(s?.specs?.gpu || '') + ' ' + String(s?.gpu_array || '');
  if (!/3090/.test(gpu)) return false;
  const count = Array.isArray(s.gpu_array) ? s.gpu_array.length : 1;
  return count <= 1 || s.partial_gpu_rental === true;
});
usd.sort(
  (a, b) =>
    Number(a.price.on_demand['USD-Blockchain']) -
    Number(b.price.on_demand['USD-Blockchain']),
);

const target = usd[0];
if (!target) {
  console.error('No USD 3090 target');
  process.exit(1);
}

const daily = Number(target.price.on_demand['USD-Blockchain']);
console.log('target', {
  id: target.id,
  gpu: target.specs?.gpu,
  daily,
  allowed: target.allowed_coins,
});

const variants = [
  {
    name: 'app-like',
    body: {
      renting_server: target.id,
      type: 'on-demand',
      currency: 'USD-Blockchain',
      image: IMAGE,
      ports: { '22': 'tcp', '8080': 'http' },
      env: { COMFYUI_PORT: '8080' },
      autossh_entrypoint: true,
      required_price: daily,
    },
  },
  {
    name: 'with-ssh-password',
    body: {
      renting_server: target.id,
      type: 'on-demand',
      currency: 'USD-Blockchain',
      image: IMAGE,
      ports: { '22': 'tcp', '8080': 'http' },
      env: { COMFYUI_PORT: '8080' },
      ssh_password: randomPassword(),
      required_price: daily,
    },
  },
  {
    name: 'ssh-no-required-price',
    body: {
      renting_server: target.id,
      type: 'on-demand',
      currency: 'USD-Blockchain',
      image: IMAGE,
      ports: { '22': 'tcp', '8080': 'http' },
      env: { COMFYUI_PORT: '8080' },
      ssh_password: randomPassword(),
    },
  },
  {
    name: 'cuda-base-image',
    body: {
      renting_server: target.id,
      type: 'on-demand',
      currency: 'USD-Blockchain',
      image: 'nvidia/cuda:12.8.0-base-ubuntu22.04',
      ports: { '22': 'tcp', '8080': 'http' },
      ssh_password: randomPassword(),
      required_price: daily,
    },
  },
];

const results = [];
for (const variant of variants) {
  await sleep(6000);
  const res = await api(key, 'POST', '/create_order', variant.body);
  const oid = res.payload?.order_id ?? res.payload?.id ?? null;
  console.log(variant.name, res.status, JSON.stringify(res.payload), 'oid', oid);
  results.push({ name: variant.name, status: res.status, payload: res.payload, oid });
  if (oid || (res.payload && Number(res.payload.code) === 0)) {
    if (!oid) {
      await sleep(2000);
      const again = await api(key, 'GET', '/my_orders');
      const match = (again.payload?.orders || []).find(
        (o) => String(o.renting_server ?? o.si) === String(target.id),
      );
      const recovered = match?.order_id ?? match?.id ?? null;
      console.log('recovered', recovered);
      if (recovered) {
        await sleep(1500);
        const cancel = await api(key, 'POST', '/cancel_order', { id: Number(recovered) });
        console.log('cancel', cancel.status, cancel.payload);
        results[results.length - 1].recovered = recovered;
        results[results.length - 1].cancel = cancel.payload;
        break;
      }
    } else {
      await sleep(1500);
      const cancel = await api(key, 'POST', '/cancel_order', { id: Number(oid) });
      console.log('cancel', cancel.status, cancel.payload);
      results[results.length - 1].cancel = cancel.payload;
      break;
    }
  }
}

mkdirSync(join(ROOT, 'tmp'), { recursive: true });
writeFileSync(
  join(ROOT, 'tmp', 'clore-code1-diag.json'),
  JSON.stringify({ at: new Date().toISOString(), target: { id: target.id, daily }, results }, null, 2),
);
