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
    payload = text.slice(0, 300);
  }
  return { status: res.status, payload };
}

function consistent(s) {
  const usd = Number(s?.price?.usd?.on_demand_usd || 0);
  const cloreEq = Number(s?.price?.usd?.on_demand_clore || 0);
  if (!(usd > 0 && cloreEq > 0)) return false;
  return Math.abs(usd - cloreEq) / Math.max(usd, cloreEq) <= 0.15;
}

function acceptsUsd(s) {
  return Number(s?.price?.on_demand?.['USD-Blockchain'] || 0) > 0;
}

function isLine(s, re) {
  if (s?.rented === true) return false;
  const joined = ((Array.isArray(s.gpu_array) ? s.gpu_array : []).join(' ') + ' ' + String(s?.specs?.gpu || '')).toLowerCase();
  if (/mixed/.test(joined)) return false;
  return re.test(joined) && acceptsUsd(s);
}

const market = await clore('GET', '/marketplace');
const servers = Array.isArray(market.payload?.servers) ? market.payload.servers : [];
const lines = {
  rtx3090: servers.filter((s) => isLine(s, /3090/)).filter(consistent),
  rtx4090_1x: servers
    .filter((s) => {
      if (!isLine(s, /4090/)) return false;
      const specsGpu = String(s?.specs?.gpu || '');
      const arr = Array.isArray(s.gpu_array) ? s.gpu_array : [];
      const m = specsGpu.match(/(\d+)\s*x/i);
      const host = Math.max(arr.length || 0, m ? Number(m[1]) : 0, 1);
      return host === 1 || s.partial_gpu_rental === true;
    })
    .filter(consistent),
};

const report = {
  at: new Date().toISOString(),
  marketStatus: market.status,
  counts: {
    rtx3090: lines.rtx3090.length,
    rtx4090_1x: lines.rtx4090_1x.length,
  },
  attempts: [],
};

const target =
  lines.rtx3090.sort(
    (a, b) =>
      Number(a.price.on_demand['USD-Blockchain']) - Number(b.price.on_demand['USD-Blockchain']),
  )[0] ||
  lines.rtx4090_1x.sort(
    (a, b) =>
      Number(a.price.on_demand['USD-Blockchain']) - Number(b.price.on_demand['USD-Blockchain']),
  )[0];

if (!target) {
  report.error = 'No consistent USD hosts';
} else {
  await sleep(5500);
  const daily = Number(target.price.on_demand['USD-Blockchain']);
  const body = {
    type: 'on-demand',
    currency: 'USD-Blockchain',
    image: 'dieuhaukieuhanh/gpuvietnam-comfyui:v1',
    renting_server: target.id,
    ports: { '22': 'tcp', '8080': 'http' },
    env: { GPUVIETNAM_DIAG: 'fix2' },
    autossh_entrypoint: true,
    required_price: daily,
  };
  const res = await clore('POST', '/create_order', body);
  const orderId = res.payload?.order_id ?? res.payload?.id ?? null;
  const attempt = {
    serverId: target.id,
    gpu: target.specs?.gpu,
    daily,
    status: res.status,
    code: res.payload?.code ?? null,
    error: res.payload?.error ?? null,
    orderId,
  };
  if (orderId) {
    await sleep(5500);
    const cancel = await clore('POST', '/cancel_order', { id: Number(orderId) });
    attempt.cancel = { status: cancel.status, code: cancel.payload?.code ?? null };
  }
  report.attempts.push(attempt);
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/clore-fix-smoke.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
