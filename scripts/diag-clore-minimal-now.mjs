/**
 * Minimal Clore create_order probe (no app env). Cancels on success.
 * Usage: node scripts/diag-clore-minimal-now.mjs [serverId]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  const k = t.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = v;
}

const key = (process.env.CLORE_AI_KEY || process.env.CLORE_API_KEY || '').trim();
const currency = process.env.CLORE_CURRENCY || 'USD-Blockchain';
const base = 'https://api.clore.ai/v1';

async function req(method, path, body) {
  const init = {
    method,
    headers: { Accept: 'application/json', auth: key },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const report = { at: new Date().toISOString() };
const mkt = await req('GET', '/marketplace');
const servers = Array.isArray(mkt.json?.servers) ? mkt.json.servers : [];
const targetId = Number(process.argv[2] || 0);
let server = targetId
  ? servers.find((s) => Number(s.id) === targetId)
  : servers.find(
      (s) =>
        String(s.specs?.gpu || s.gpu || '').toLowerCase().includes('3090') &&
        Number(s.reliability ?? s.rating ?? 0) >= 0.99 &&
        s.renting_server == null,
    );
if (!server) {
  report.error = 'no server';
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

report.serverId = server.id;
report.reliability = server.reliability ?? server.rating;
await new Promise((r) => setTimeout(r, 2000));

const body = {
  currency,
  image: 'dieuhaukieuhanh/gpuvietnam-comfyui:v1',
  renting_server: Number(server.id),
  type: 'on-demand',
  ports: { '22': 'tcp', '8080': 'http' },
  ssh_password: 'GvTestPass123A1',
};
report.body = body;
const created = await req('POST', '/create_order', body);
report.create = { status: created.status, json: created.json };

let orderId =
  created.json?.order_id ?? created.json?.id ?? created.json?.orderId ?? null;
if (!orderId && Number(created.json?.code) === 0) {
  await new Promise((r) => setTimeout(r, 2500));
  const orders = await req('GET', '/my_orders');
  const list = Array.isArray(orders.json?.orders) ? orders.json.orders : [];
  const hit = list.find((o) => Number(o.si ?? o.renting_server) === Number(server.id));
  orderId = hit?.order_id ?? hit?.id ?? null;
  report.recovered = orderId;
}
if (orderId) {
  await new Promise((r) => setTimeout(r, 5000));
  report.cancel = await req('POST', '/cancel_order', { id: Number(orderId), order_id: Number(orderId) });
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/clore-minimal-now.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
