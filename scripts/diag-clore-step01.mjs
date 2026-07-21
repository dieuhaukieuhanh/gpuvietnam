/**
 * Step 0+1 Clore incident smoke (no app UI).
 * Loads .env.local, never prints secrets.
 * Usage: node scripts/diag-clore-step01.mjs [--rent]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const RENT = process.argv.includes('--rent');
const BASE = 'https://api.clore.ai/v1';
const APP_IMAGE = 'dieuhaukieuhanh/gpuvietnam-comfyui:v1';
const SAFE_IMAGE = 'nvidia/cuda:12.8.0-base-ubuntu22.04';

function loadEnvLocal() {
  const path = join(ROOT, '.env.local');
  const text = readFileSync(path, 'utf8');
  /** @type {Record<string, string>} */
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function mask(v) {
  if (!v) return 'MISSING';
  return 'SET(len=' + v.length + ')';
}

/**
 * @param {string} apiKey
 * @param {'GET'|'POST'} method
 * @param {string} path
 * @param {Record<string, unknown>} [body]
 */
async function clore(apiKey, method, path, body) {
  const headers = {
    Accept: 'application/json',
    auth: apiKey,
  };
  /** @type {RequestInit} */
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const started = Date.now();
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text.slice(0, 500);
  }
  return {
    status: res.status,
    ok: res.ok,
    ms: Date.now() - started,
    payload,
    rawPreview: typeof payload === 'string' ? payload : undefined,
  };
}

function dailyUsd(server) {
  const usd = server?.price?.usd?.on_demand_usd;
  if (Number.isFinite(Number(usd)) && Number(usd) > 0) return Number(usd);
  const chain = server?.price?.on_demand?.['USD-Blockchain'];
  if (Number.isFinite(Number(chain)) && Number(chain) > 0) return Number(chain);
  return 0;
}

function is4090_1x(server) {
  if (server?.rented === true) return false;
  const arr = Array.isArray(server?.gpu_array) ? server.gpu_array : [];
  const specsGpu = String(server?.specs?.gpu ?? '');
  const joined = (arr.join(' ') + ' ' + specsGpu).toLowerCase();
  if (!/4090/.test(joined) || /mixed/.test(joined)) return false;
  const match = specsGpu.match(/(\d+)\s*x/i);
  const fromSpecs = match ? Number(match[1]) : 0;
  const hostGpuCount = Math.max(arr.length || 0, fromSpecs || 0, 1);
  if (hostGpuCount !== 1 && server?.partial_gpu_rental !== true) return false;
  return dailyUsd(server) > 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function summarizeErr(res) {
  const p = res.payload;
  if (p && typeof p === 'object') {
    return {
      httpStatus: res.status,
      code: p.code ?? null,
      error: p.error ?? p.message ?? null,
      keys: Object.keys(p).slice(0, 20),
    };
  }
  return { httpStatus: res.status, error: res.rawPreview || String(p) };
}

function summarizeWallets(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const wallets = payload.wallets ?? payload.data ?? payload;
  if (Array.isArray(wallets)) {
    return wallets.map((w) => ({
      currency: w.currency ?? w.name ?? w.ticker ?? null,
      balancePositive: Number(w.balance ?? w.amount ?? 0) > 0,
      balance: w.balance ?? w.amount ?? null,
    }));
  }
  if (wallets && typeof wallets === 'object') {
    return Object.entries(wallets).map(([k, v]) => {
      if (v && typeof v === 'object') {
        const bal = /** @type {Record<string, unknown>} */ (v).balance ?? /** @type {Record<string, unknown>} */ (v).amount;
        return { currency: k, balancePositive: Number(bal) > 0, balance: bal ?? null };
      }
      return { currency: k, balancePositive: Number(v) > 0, balance: v };
    });
  }
  return { rawKeys: Object.keys(payload).slice(0, 20) };
}

function writeReport(report) {
  const dir = join(ROOT, 'tmp');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'clore-step01-report.json'), JSON.stringify(report, null, 2));
}

async function main() {
  const env = loadEnvLocal();
  const apiKey = (env.CLORE_API_KEY || env.CLORE_AI_KEY || '').trim();
  const vastKey = (env.VAST_AI_KEY || env.VAST_API_KEY || '').trim();
  const currency = (env.CLORE_CURRENCY || 'USD-Blockchain').trim();
  const image = (env.DEFAULT_GPU_IMAGE || env.GPUVIETNAM_COMFYUI_IMAGE || APP_IMAGE).trim();

  /** @type {Record<string, unknown>} */
  const report = {
    at: new Date().toISOString(),
    step: '0+1',
    rentMode: RENT,
    env: {
      CLORE_API_KEY: mask(env.CLORE_API_KEY),
      CLORE_AI_KEY: mask(env.CLORE_AI_KEY),
      cloreKeyResolved: mask(apiKey),
      VAST_AI_KEY: mask(env.VAST_AI_KEY),
      VAST_API_KEY: mask(env.VAST_API_KEY),
      vastKeyResolved: mask(vastKey),
      CLORE_CURRENCY: env.CLORE_CURRENCY ? 'SET(' + env.CLORE_CURRENCY + ')' : 'DEFAULT(' + currency + ')',
      DEFAULT_GPU_IMAGE: env.DEFAULT_GPU_IMAGE ? 'SET' : 'DEFAULT(' + image + ')',
      GPU_PROVIDER: env.GPU_PROVIDER || env.DEFAULT_GPU_PROVIDER || '(unset)',
    },
    lastStartError: null,
    checks: {},
  };

  try {
    report.lastStartError = JSON.parse(readFileSync(join(ROOT, 'tmp/last-start-error.json'), 'utf8'));
  } catch {
    report.lastStartError = null;
  }

  if (!apiKey) {
    report.checks.auth = { ok: false, error: 'No Clore API key in .env.local' };
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const myOrders = await clore(apiKey, 'GET', '/my_orders');
  report.checks.my_orders = {
    status: myOrders.status,
    ms: myOrders.ms,
    code: myOrders.payload?.code ?? null,
    orderCount: Array.isArray(myOrders.payload?.orders) ? myOrders.payload.orders.length : null,
    error: myOrders.ok ? null : summarizeErr(myOrders),
  };

  const wallets = await clore(apiKey, 'GET', '/wallets');
  report.checks.wallets = {
    status: wallets.status,
    ms: wallets.ms,
    code: wallets.payload?.code ?? null,
    error: wallets.ok ? null : summarizeErr(wallets),
    balances: summarizeWallets(wallets.payload),
  };

  const market = await clore(apiKey, 'GET', '/marketplace');
  const servers = Array.isArray(market.payload?.servers) ? market.payload.servers : [];
  const candidates = servers.filter(is4090_1x).sort((a, b) => dailyUsd(a) - dailyUsd(b));
  report.checks.marketplace = {
    status: market.status,
    ms: market.ms,
    totalServers: servers.length,
    availableRtx4090_1x: candidates.length,
    cheapest3: candidates.slice(0, 3).map((s) => ({
      id: s.id,
      dailyUsd: dailyUsd(s),
      gpu: s.specs?.gpu ?? s.gpu_array,
      reliability: s.reliability,
      region: s.specs?.net?.cc ?? s.country,
      partial: s.partial_gpu_rental === true,
    })),
    error: market.ok ? null : summarizeErr(market),
  };

  if (!RENT) {
    report.checks.create_order = {
      skipped: true,
      reason: 'Pass --rent to attempt create_order + cancel',
    };
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (!candidates.length) {
    report.checks.create_order = { skipped: true, reason: 'No available rtx4090_1x candidates' };
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const target = candidates[0];
  const requiredPrice = dailyUsd(target);
  /** @type {Array<Record<string, unknown>>} */
  const attempts = [];
  const variants = [
    {
      name: 'app_image_with_required_price',
      body: {
        type: 'on-demand',
        currency,
        image,
        renting_server: target.id,
        required_price: requiredPrice,
        ports: { '22': 'tcp', '8080': 'http' },
        env: { GPUVIETNAM_DIAG: 'step01' },
        autossh_entrypoint: true,
      },
    },
    {
      name: 'app_image_no_required_price',
      body: {
        type: 'on-demand',
        currency,
        image,
        renting_server: target.id,
        ports: { '22': 'tcp', '8080': 'http' },
        env: { GPUVIETNAM_DIAG: 'step01' },
        autossh_entrypoint: true,
      },
    },
    {
      name: 'safe_cuda_image_no_required_price',
      body: {
        type: 'on-demand',
        currency,
        image: SAFE_IMAGE,
        renting_server: target.id,
        ports: { '22': 'tcp', '8080': 'http' },
        env: { GPUVIETNAM_DIAG: 'step01' },
        autossh_entrypoint: true,
      },
    },
  ];

  for (const variant of variants) {
    if (attempts.length) await sleep(5500);
    const res = await clore(apiKey, 'POST', '/create_order', variant.body);
    const orderId = res.payload?.order_id ?? res.payload?.id ?? null;
    /** @type {Record<string, unknown>} */
    const attempt = {
      name: variant.name,
      serverId: target.id,
      dailyUsd: requiredPrice,
      currency,
      image: variant.body.image,
      hasRequiredPrice: Object.prototype.hasOwnProperty.call(variant.body, 'required_price'),
      status: res.status,
      ms: res.ms,
      code: res.payload?.code ?? null,
      orderId,
      error:
        res.ok && (res.payload?.code === 0 || res.payload?.code == null)
          ? null
          : summarizeErr(res),
      responseKeys:
        res.payload && typeof res.payload === 'object' ? Object.keys(res.payload).slice(0, 30) : [],
    };

    if (orderId) {
      await sleep(5500);
      const cancel = await clore(apiKey, 'POST', '/cancel_order', { id: Number(orderId) });
      attempt.cancel = {
        status: cancel.status,
        code: cancel.payload?.code ?? null,
        error: cancel.ok ? null : summarizeErr(cancel),
      };
      attempts.push(attempt);
      break;
    }
    attempts.push(attempt);
  }

  report.checks.create_order = { targetServerId: target.id, attempts };
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
