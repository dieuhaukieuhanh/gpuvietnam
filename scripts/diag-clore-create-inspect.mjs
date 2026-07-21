import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

function loadEnv() {
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
    payload = text.slice(0, 500);
  }
  return { status: res.status, payload };
}

function consistent(s) {
  const usd = Number(s?.price?.usd?.on_demand_usd || 0);
  const cloreEq = Number(s?.price?.usd?.on_demand_clore || 0);
  if (!(usd > 0 && cloreEq > 0)) return false;
  return Math.abs(usd - cloreEq) / Math.max(usd, cloreEq) <= 0.15;
}

function is3090_1x(s) {
  if (s?.rented === true) return false;
  const arr = Array.isArray(s.gpu_array) ? s.gpu_array : [];
  const specsGpu = String(s?.specs?.gpu || '');
  const joined = (arr.join(' ') + ' ' + specsGpu).toLowerCase();
  if (!/3090/.test(joined) || /mixed/.test(joined)) return false;
  const m = specsGpu.match(/(\d+)\s*x/i);
  const host = Math.max(arr.length || 0, m ? Number(m[1]) : 0, 1);
  if (host !== 1 && s.partial_gpu_rental !== true) return false;
  const chain = Number(s?.price?.on_demand?.['USD-Blockchain'] || 0);
  return chain > 0 && consistent(s);
}

await sleep(2000);
const market = await clore('GET', '/marketplace');
const servers = Array.isArray(market.payload?.servers) ? market.payload.servers : [];
const candidates = servers
  .filter(is3090_1x)
  .sort(
    (a, b) =>
      Number(a.price.on_demand['USD-Blockchain']) - Number(b.price.on_demand['USD-Blockchain']),
  );

const report = {
  at: new Date().toISOString(),
  candidateCount: candidates.length,
  target: candidates[0]
    ? {
        id: candidates[0].id,
        gpu: candidates[0].specs?.gpu,
        daily: candidates[0].price?.on_demand?.['USD-Blockchain'],
      }
    : null,
};

if (!candidates[0]) {
  mkdirSync('tmp', { recursive: true });
  writeFileSync('tmp/clore-create-response.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

await sleep(5500);
const t = candidates[0];
const body = {
  type: 'on-demand',
  currency: 'USD-Blockchain',
  image: 'dieuhaukieuhanh/gpuvietnam-comfyui:v1',
  renting_server: t.id,
  ports: { '22': 'tcp', '8080': 'http' },
  env: { GPUVIETNAM_DIAG: 'fix3' },
  autossh_entrypoint: true,
};
const res = await clore('POST', '/create_order', body);
report.create = {
  status: res.status,
  payload: res.payload,
};
const orderId =
  res.payload?.order_id ??
  res.payload?.id ??
  res.payload?.order?.order_id ??
  res.payload?.order?.id ??
  null;
report.parsedOrderId = orderId;
if (orderId) {
  await sleep(5500);
  report.cancel = await clore('POST', '/cancel_order', { id: Number(orderId) });
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/clore-create-response.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
