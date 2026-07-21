/**
 * List Clore my_orders and cancel any live orders (orphan cleanup).
 * Usage: node scripts/diag-clore-cancel-orphans.mjs
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

await sleep(2000);
let orders = await api('GET', '/my_orders');
if (orders.status === 429) {
  await sleep(5000);
  orders = await api('GET', '/my_orders');
}

const list = Array.isArray(orders.json?.orders) ? orders.json.orders : [];
const report = {
  at: new Date().toISOString(),
  listStatus: orders.status,
  listCode: orders.json?.code ?? null,
  orderCount: list.length,
  orders: list.map((o) => ({
    id: o.id ?? o.order_id,
    si: o.si ?? o.renting_server,
    image: o.image,
    online: o.online,
  })),
  cancels: [],
};

for (const o of list) {
  const id = o.id ?? o.order_id;
  if (id == null) continue;
  await sleep(1500);
  const c = await api('POST', '/cancel_order', { id: Number(id) });
  report.cancels.push({
    id,
    status: c.status,
    code: c.json?.code ?? null,
    error: c.json?.error ?? null,
  });
}

mkdirSync('tmp', { recursive: true });
writeFileSync(join(ROOT, 'tmp/clore-orphan-cancel-now.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
