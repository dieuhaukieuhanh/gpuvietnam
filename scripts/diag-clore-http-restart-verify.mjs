/**
 * Clore HTTP restart verification (support hypothesis).
 *
 * Protocol (no product-gate destroy):
 *   1. create_order (bypass provision gate)
 *   2. wait http_pub + SSH
 *   3. probe public /system_stats  (BEFORE)
 *   4. SSH: local listen check + restart Comfy on 0.0.0.0:8080
 *   5. probe public /system_stats  (AFTER)
 *   6. cancel_order
 *
 * Usage:
 *   node scripts/diag-clore-http-restart-verify.mjs
 *   node scripts/diag-clore-http-restart-verify.mjs --count=3
 *   node scripts/diag-clore-http-restart-verify.mjs --observe-only --count=3
 *     (product onstart: wait for public HTTP, no SSH restart)
 *   node scripts/diag-clore-http-restart-verify.mjs --gpu=rtx3090 --plan=starter
 *   node scripts/diag-clore-http-restart-verify.mjs --dry-run
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const REPORT_JSONL = 'tmp/clore-http-restart-verify.jsonl';
const REPORT_LATEST = 'tmp/clore-http-restart-verify-latest.json';

function loadEnv() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

function parseArgs(argv) {
  /** @type {{ count: number; gpu: string; plan: string; dryRun: boolean; keep: boolean; autossh: boolean; sshWaitMs: number; observeOnly: boolean; observeMs: number }} */
  const out = {
    count: 1,
    gpu: 'rtx3090',
    plan: 'starter',
    dryRun: false,
    keep: false,
    /** Clore entrypoint that deploys SSH — needed to test in-server restart on many hosts. */
    autossh: true,
    sshWaitMs: 240_000,
    /** Product path: wait for public HTTP from onstart; do not SSH-restart. */
    observeOnly: false,
    observeMs: 360_000,
  };
  for (const arg of argv) {
    if (arg.startsWith('--count=')) out.count = Math.max(1, Number(arg.slice(8)) || 1);
    else if (arg.startsWith('--gpu=')) out.gpu = arg.slice(6).trim() || out.gpu;
    else if (arg.startsWith('--plan=')) out.plan = arg.slice(7).trim() || out.plan;
    else if (arg.startsWith('--ssh-wait-ms=')) {
      out.sshWaitMs = Math.max(30_000, Number(arg.slice(14)) || 240_000);
    } else if (arg.startsWith('--observe-ms=')) {
      out.observeMs = Math.max(60_000, Number(arg.slice(13)) || 360_000);
    } else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--keep') out.keep = true;
    else if (arg === '--no-autossh') out.autossh = false;
    else if (arg === '--autossh') out.autossh = true;
    else if (arg === '--observe-only') out.observeOnly = true;
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} url
 * @param {number} [timeoutMs]
 */
async function probePublicSystemStats(url, timeoutMs = 12_000) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!base) {
    return { ok: false, kind: 'no_url', status: 0, snippet: '' };
  }
  try {
    const res = await fetch(`${base}/system_stats`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    const text = await res.text();
    if (/proxy\s*not\s*found/i.test(text)) {
      return { ok: false, kind: 'proxy_not_found', status: res.status, snippet: text.slice(0, 160) };
    }
    if (/502|bad gateway/i.test(text)) {
      return { ok: false, kind: 'bad_gateway_502', status: res.status, snippet: text.slice(0, 160) };
    }
    if (/proxy is starting/i.test(text)) {
      return { ok: false, kind: 'proxy_starting', status: res.status, snippet: text.slice(0, 160) };
    }
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    if (res.ok && json && typeof json === 'object') {
      return { ok: true, kind: 'json_ok', status: res.status, snippet: text.slice(0, 160) };
    }
    return {
      ok: false,
      kind: `http_${res.status}`,
      status: res.status,
      snippet: text.slice(0, 160),
    };
  } catch (err) {
    return {
      ok: false,
      kind: 'fetch_error',
      status: 0,
      snippet: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildRestartScript(port) {
  const p = Number(port) || 8080;
  return [
    'set -uo pipefail',
    `PORT=${p}`,
    'MARKER=gpuvietnam_comfy_restart_ok',
    'echo "[diag] pid1=$(cat /proc/1/cmdline 2>/dev/null | tr \"\\0\" \" \" || true)"',
    'echo "[diag] listeners:"',
    '(ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null || true) | grep -E ":${PORT}\\b" || true',
    'LOCAL_BEFORE=fail',
    'if curl -sf --max-time 3 "http://127.0.0.1:${PORT}/system_stats" >/dev/null 2>&1; then LOCAL_BEFORE=ok; fi',
    'echo "[diag] local_before=${LOCAL_BEFORE}"',
    'PY_PIDS=$(pgrep -f "python.*main\\.py" 2>/dev/null || true)',
    'echo "[diag] comfy_pids=${PY_PIDS}"',
    'for pid in ${PY_PIDS}; do',
    '  if [ "${pid}" = "1" ]; then echo "[diag] skip_kill_pid1"; continue; fi',
    '  kill "${pid}" 2>/dev/null || true',
    'done',
    'sleep 2',
    'if [ -f /app/ComfyUI/main.py ]; then',
    '  cd /app/ComfyUI',
    '  nohup python main.py --listen 0.0.0.0 --port "${PORT}" --enable-cors-header "*" >>/tmp/comfy-diag-restart.log 2>&1 &',
    '  echo "[diag] launched_bg_pid=$!"',
    'else',
    '  echo "[diag] missing_/app/ComfyUI/main.py"',
    'fi',
    'LOCAL_AFTER=fail',
    'for _ in $(seq 1 60); do',
    '  if curl -sf --max-time 3 "http://127.0.0.1:${PORT}/system_stats" >/dev/null 2>&1; then LOCAL_AFTER=ok; break; fi',
    '  sleep 2',
    'done',
    'echo "[diag] local_after=${LOCAL_AFTER}"',
    '(ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null || true) | grep -E ":${PORT}\\b" || true',
    'if [ "${LOCAL_AFTER}" = "ok" ]; then echo "${MARKER}"; exit 0; fi',
    'echo "[diag] restart_timeout"',
    'exit 1',
  ].join('\n');
}

loadEnv();
const args = parseArgs(process.argv.slice(2));

const {
  CloreClient,
  CLORE_CREATE_ORDER_MIN_INTERVAL_MS,
  extractCloreOrderId,
  sanitizeCloreContainerEnv,
  buildCloreOnstartCommand,
} = await import(
  pathToFileURL(join(process.cwd(), 'src/lib/gpu/providers/clore/clore-client.js')).href
);
const { resolveGpuImage, DEFAULT_GPU_PORT } = await import(
  pathToFileURL(join(process.cwd(), 'src/lib/gpu/gpu-config.js')).href
);
const { resolveClorePublicEndpoints } = await import(
  pathToFileURL(join(process.cwd(), 'src/lib/gpu/providers/clore/clore-mapper.js')).href
);
const { resolveSshTargetFromClore, sshExec } = await import(
  pathToFileURL(join(process.cwd(), 'src/lib/machine-ssh.js')).href
);

const client = new CloreClient();
const comfyPort = DEFAULT_GPU_PORT;
const image = resolveGpuImage(args.gpu);
const sshPassword =
  String(process.env.CLORE_SSH_PASSWORD ?? '').trim() ||
  `Gv${Math.random().toString(36).slice(2, 10)}A1`;

/** @type {Array<Record<string, unknown>>} */
const trials = [];
/** @type {Set<string>} */
const usedServers = new Set();

console.log('[diag-clore-http-restart] config', {
  configured: client.isConfigured(),
  currency: client.currency,
  gpu: args.gpu,
  plan: args.plan,
  image,
  count: args.count,
  dryRun: args.dryRun,
  autossh: args.autossh,
  observeOnly: args.observeOnly,
  observeMs: args.observeMs,
  sshWaitMs: args.sshWaitMs,
  gpuCloreOnly: process.env.GPU_CLORE_ONLY,
});

if (!client.isConfigured()) {
  console.error('CLORE_AI_KEY / CLORE_API_KEY missing');
  process.exit(1);
}

/**
 * @param {import('../src/lib/gpu/offer-selection.js').RankedOffer} best
 * @param {number} index
 */
async function runOneTrial(best, index) {
  const serverId = Number(best.offerId);
  /** @type {Record<string, unknown>} */
  const row = {
    at: new Date().toISOString(),
    index,
    offerId: serverId,
    region: best.region ?? null,
    pricePerHour: best.pricePerHour ?? null,
    uptimePercent: best.uptimePercent ?? null,
    image,
    orderId: null,
    httpPub: null,
    publicUrl: null,
    before: null,
    ssh: null,
    restart: null,
    after: null,
    after2m: null,
    verdict: null,
    error: null,
    cancel: null,
  };

  /** @type {Record<string, unknown>} */
  const body = {
    type: 'on-demand',
    currency: client.currency,
    image,
    renting_server: serverId,
    ports: {
      '22': 'tcp',
      [String(comfyPort)]: 'http',
    },
    env: sanitizeCloreContainerEnv({
      COMFYUI_PORT: String(comfyPort),
      GPUVIETNAM_DIAG: args.observeOnly ? 'onstart-observe' : 'http-restart-verify',
      GPUVIETNAM_PACKAGE: args.plan,
    }),
    ssh_password: sshPassword,
  };
  // Same as product create_order: autossh + onstart that binds Comfy immediately.
  if (args.autossh) {
    body.autossh_entrypoint = true;
    body.command = buildCloreOnstartCommand(comfyPort);
  }
  row.autossh = args.autossh;
  row.observeOnly = args.observeOnly;

  console.log(`\n=== trial ${index}/${args.count} rent server=${serverId} region=${best.region} ===`);
  if (args.dryRun) {
    row.verdict = 'dry_run';
    row.error = 'dry-run — not rented';
    return row;
  }

  let rented;
  try {
    rented = await client.request('POST', '/create_order', body);
  } catch (err) {
    row.error = err instanceof Error ? err.message : String(err);
    row.verdict = 'rent_fail';
    return row;
  }

  let orderId = extractCloreOrderId(rented);
  if (!orderId) {
    try {
      orderId = await client.recoverOrderIdAfterCreate(serverId, rented, {
        label: 'http-restart-verify',
      });
    } catch {
      /* ignore */
    }
  }
  row.orderId = orderId;
  if (!orderId) {
    row.error = 'no order_id after create_order';
    row.verdict = 'rent_fail';
    return row;
  }
  console.log('[diag] order_id=', orderId);

  /** @type {Record<string, unknown> | null} */
  let order = null;
  const waitDeadline = Date.now() + 180_000;
  while (Date.now() < waitDeadline) {
    try {
      order = await client.getOrder(orderId);
    } catch (err) {
      console.warn('[diag] getOrder', err instanceof Error ? err.message : err);
    }
    const ep = order ? resolveClorePublicEndpoints(order, comfyPort) : null;
    if (ep?.endpointUrl) {
      row.httpPub = order?.http_pub ?? null;
      row.publicUrl = ep.endpointUrl;
      break;
    }
    await sleep(5_000);
  }

  if (!row.publicUrl) {
    row.error = 'http_pub timeout';
    row.verdict = 'no_http_pub';
    if (!args.keep) {
      try {
        row.cancel = await client.destroyInstance(orderId);
      } catch (err) {
        row.cancel = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    return row;
  }
  console.log('[diag] publicUrl=', row.publicUrl);

  // Give container a bit of boot time before first public probe.
  await sleep(15_000);
  row.before = await probePublicSystemStats(String(row.publicUrl));
  console.log('[diag] BEFORE public', row.before.kind, row.before.status);

  // Product-path check: wait for onstart to bring public HTTP up (no SSH restart).
  if (args.observeOnly) {
    const observeDeadline = Date.now() + args.observeMs;
    /** @type {{ ok: boolean; kind: string; status: number; snippet: string } | null} */
    let last = row.before;
    while (Date.now() < observeDeadline) {
      last = await probePublicSystemStats(String(row.publicUrl));
      console.log('[diag] OBSERVE public', last.kind, last.status);
      if (last.ok) break;
      await sleep(10_000);
    }
    row.after = last;
    row.verdict = last?.ok
      ? 'self_start_ok'
      : `self_start_fail:${last?.kind || 'unknown'}`;

    if (!args.keep) {
      try {
        await sleep(Math.max(0, CLORE_CREATE_ORDER_MIN_INTERVAL_MS - 1000));
        row.cancel = await client.destroyInstance(orderId);
        console.log('[diag] cancelled', orderId);
      } catch (err) {
        row.cancel = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    return row;
  }

  // SSH wait (Clore often needs several minutes after http_pub appears)
  const sshDeadline = Date.now() + args.sshWaitMs;
  /** @type {import('../src/lib/machine-ssh.js').SshTarget | null} */
  let sshTarget = null;
  let sshDetail = 'waiting';
  while (Date.now() < sshDeadline) {
    try {
      order = await client.getOrder(orderId);
      sshTarget = order ? resolveSshTargetFromClore(order, { password: sshPassword }) : null;
      if (sshTarget?.host && sshTarget.port) {
        const echo = await sshExec(sshTarget, 'echo gpuvietnam_ssh_ok');
        if (String(echo?.stdout ?? '').includes('gpuvietnam_ssh_ok')) {
          sshDetail = 'ssh_ok';
          break;
        }
        sshDetail = 'echo mismatch';
      } else {
        sshDetail = 'no ssh host/port yet';
      }
    } catch (err) {
      sshDetail = err instanceof Error ? err.message : String(err);
    }
    await sleep(5_000);
  }
  row.ssh = { ok: sshDetail === 'ssh_ok', detail: sshDetail, target: sshTarget
    ? { host: sshTarget.host, port: sshTarget.port }
    : null };

  if (sshDetail !== 'ssh_ok' || !sshTarget) {
    row.verdict = 'ssh_fail';
    row.after = await probePublicSystemStats(String(row.publicUrl));
  } else {
    const script = buildRestartScript(comfyPort);
    const b64 = Buffer.from(script, 'utf8').toString('base64');
    const cmd = `echo ${b64} | base64 -d | bash`;
    console.log('[diag] SSH restart…');
    try {
      const result = await Promise.race([
        sshExec(sshTarget, cmd),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('ssh restart timeout 240s')), 240_000),
        ),
      ]);
      const out = String(result?.stdout ?? '');
      const err = String(result?.stderr ?? '');
      row.restart = {
        ok: out.includes('gpuvietnam_comfy_restart_ok'),
        localBefore: /local_before=ok/.test(out) ? 'ok' : /local_before=fail/.test(out) ? 'fail' : 'unknown',
        localAfter: /local_after=ok/.test(out) ? 'ok' : /local_after=fail/.test(out) ? 'fail' : 'unknown',
        skippedPid1: /skip_kill_pid1/.test(out),
        stdout: out.slice(0, 1200),
        stderr: err.slice(0, 400),
      };
      console.log('[diag] restart', {
        ok: row.restart.ok,
        localBefore: row.restart.localBefore,
        localAfter: row.restart.localAfter,
        skippedPid1: row.restart.skippedPid1,
      });
    } catch (err) {
      row.restart = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      console.warn('[diag] restart error', row.restart.error);
    }

    await sleep(15_000);
    row.after = await probePublicSystemStats(String(row.publicUrl));
    console.log('[diag] AFTER public (+15s)', row.after.kind, row.after.status);

    await sleep(105_000);
    row.after2m = await probePublicSystemStats(String(row.publicUrl));
    console.log('[diag] AFTER public (+2m)', row.after2m.kind, row.after2m.status);

    const beforeOk = Boolean(row.before?.ok);
    const afterOk = Boolean(row.after?.ok || row.after2m?.ok);
    if (beforeOk && afterOk) row.verdict = 'already_ok';
    else if (!beforeOk && afterOk) row.verdict = 'restart_fixed_proxy';
    else if (!beforeOk && !afterOk && row.restart?.ok) row.verdict = 'local_ok_public_still_fail';
    else if (!beforeOk && !afterOk && row.restart?.skippedPid1) row.verdict = 'restart_blocked_pid1';
    else if (!beforeOk && !afterOk) row.verdict = 'restart_did_not_help';
    else row.verdict = 'unknown';
  }

  if (!args.keep) {
    try {
      await sleep(Math.max(0, CLORE_CREATE_ORDER_MIN_INTERVAL_MS - 1000));
      row.cancel = await client.destroyInstance(orderId);
      console.log('[diag] cancelled', orderId);
    } catch (err) {
      row.cancel = { error: err instanceof Error ? err.message : String(err) };
      console.warn('[diag] cancel failed', row.cancel.error);
    }
  } else {
    console.warn('[diag] --keep set; order NOT cancelled:', orderId);
  }

  return row;
}

const ranked = await client.findRankedOffers(args.gpu, args.plan);
console.log('[diag] ranked offers', ranked.length);
if (!ranked.length) {
  console.error('No ranked Clore offers');
  process.exit(1);
}

for (let i = 1; i <= args.count; i++) {
  const best = ranked.find((o) => !usedServers.has(String(o.offerId)));
  if (!best) {
    console.warn('[diag] no more unused offers');
    break;
  }
  usedServers.add(String(best.offerId));
  const row = await runOneTrial(best, i);
  trials.push(row);
  mkdirSync('tmp', { recursive: true });
  appendFileSync(REPORT_JSONL, `${JSON.stringify(row)}\n`);
  if (i < args.count && !args.dryRun) {
    await sleep(CLORE_CREATE_ORDER_MIN_INTERVAL_MS);
  }
}

const summary = {
  at: new Date().toISOString(),
  gpu: args.gpu,
  plan: args.plan,
  image,
  countRequested: args.count,
  countRan: trials.length,
  byVerdict: trials.reduce((acc, t) => {
    const k = String(t.verdict || 'unknown');
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, /** @type {Record<string, number>} */ ({})),
  trials: trials.map((t) => ({
    index: t.index,
    offerId: t.offerId,
    region: t.region,
    orderId: t.orderId,
    observeOnly: t.observeOnly ?? false,
    before: t.before?.kind ?? null,
    restartOk: t.restart?.ok ?? null,
    localBefore: t.restart?.localBefore ?? null,
    localAfter: t.restart?.localAfter ?? null,
    after: t.after?.kind ?? null,
    after2m: t.after2m?.kind ?? null,
    verdict: t.verdict,
  })),
};

mkdirSync('tmp', { recursive: true });
writeFileSync(REPORT_LATEST, JSON.stringify({ summary, trials }, null, 2));
console.log('\n======== SUMMARY ========');
console.log(JSON.stringify(summary, null, 2));
console.log(`\nWrote ${REPORT_LATEST} and appended ${REPORT_JSONL}`);
