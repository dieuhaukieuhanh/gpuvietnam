/**
 * HTTP-first provision gate (customer-path) — shared by Clore + Vast.
 *
 * Contract (Phase 0):
 * - Hard pass = public Comfy base URL answers:
 *   1) GET /system_stats with a CUDA/NVIDIA device matching gpuLine tokens
 *   2) POST /prompt smoke (EmptyImage → PreviewImage) reaches history OK
 * - Soft (ops only) = SSH echo ready. SSH fail must NOT destroy the machine
 *   when hard path passed; surface ops_degraded + ssh_ok=false.
 * - SSH is for backup fallback / workspace ops — not the customer UX path.
 *
 * Metrics to watch (logs):
 * - gate.http_pass / gate.http_fail.{http_endpoint|gpu_stats|comfy_smoke}
 * - gate.ssh_soft_fail / gate.ssh_soft_ok
 */

import { VAST_PROVISION_GATE } from './gpu-config.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function normalizeComfyBaseUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    const parsed = new URL(withScheme);
    // Strip trailing slash; keep origin + pathname without trailing /
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${path === '/' ? '' : path}`;
  } catch {
    return null;
  }
}

/**
 * @param {string} reason
 * @returns {'http_endpoint'|'gpu_stats'|'comfy_smoke'|'ssh_exec'|'port'|'nvidia_smi'|'cuda'|'comfy_workflow'|'slow'|'default'}
 */
export function classifyProvisionGateFailReason(reason) {
  const s = String(reason ?? '').toLowerCase();
  if (s.includes('http_endpoint') || (s.includes('endpoint') && !s.includes('ssh'))) {
    return 'http_endpoint';
  }
  if (s.includes('gpu_stats') || s.includes('system_stats') && s.includes('gpu')) {
    return 'gpu_stats';
  }
  if (s.includes('comfy_smoke') || (s.includes('comfy') && s.includes('smoke'))) {
    return 'comfy_smoke';
  }
  if (s.includes('ssh') || s.includes('exec')) return 'ssh_exec';
  if (s.includes('port') || s.includes('mapped')) return 'port';
  if (s.includes('nvidia') || s.includes('smi') || s.includes('gpu name') || s.includes('vram')) {
    return 'nvidia_smi';
  }
  if (s.includes('cuda')) return 'cuda';
  if (s.includes('comfy') || s.includes('workflow') || s.includes('system_stats')) {
    return 'comfy_workflow';
  }
  if (s.includes('slow') || (s.includes('timeout') && s.includes('late'))) return 'slow';
  return 'default';
}

/**
 * @param {unknown} stats
 * @param {string} gpuLine
 * @param {typeof VAST_PROVISION_GATE} [cfg]
 * @returns {{ ok: boolean; detail: string; deviceName?: string }}
 */
export function parseSystemStatsGpuGate(stats, gpuLine, cfg = VAST_PROVISION_GATE) {
  if (!stats || typeof stats !== 'object') {
    return { ok: false, detail: 'system_stats empty' };
  }
  const rec = /** @type {Record<string, unknown>} */ (stats);
  let devices = rec.devices ?? [];
  if (devices && typeof devices === 'object' && !Array.isArray(devices)) {
    devices = Object.values(/** @type {Record<string, unknown>} */ (devices));
  }
  if (!Array.isArray(devices) || devices.length === 0) {
    return { ok: false, detail: 'system_stats: no devices' };
  }

  /** @type {string[]} */
  const names = [];
  let cudaOk = false;
  for (const d of devices) {
    if (!d || typeof d !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (d);
    const name = String(row.name ?? row.type ?? '').trim();
    if (name) names.push(name);
    const t = name.toLowerCase();
    const vram = Number(row.vram_total ?? row.vram_total_gb ?? 0) || 0;
    if (t.includes('cuda') || t.includes('nvidia') || t.includes('geforce') || t.includes('rtx') || vram > 0) {
      cudaOk = true;
    }
  }
  if (!cudaOk) {
    return { ok: false, detail: `gpu_stats: no CUDA device (${JSON.stringify(names).slice(0, 200)})` };
  }

  const expected =
    cfg.expectedGpuNameByLine[/** @type {keyof typeof cfg.expectedGpuNameByLine} */ (gpuLine)] || [];
  const joined = names.join(' ').toLowerCase();
  if (expected.length && !expected.some((tok) => joined.includes(String(tok).toLowerCase()))) {
    return {
      ok: false,
      detail: `gpu_stats: GPU name mismatch (want ${expected.join('|')}): ${names.join(', ').slice(0, 200)}`,
    };
  }
  return { ok: true, detail: names[0] || 'cuda ok', deviceName: names[0] };
}

/**
 * Clore edge often returns HTML "Proxy Not Found" while the subdomain exists
 * but the container HTTP port is not wired / not listening yet.
 * @param {string} text
 */
export function isProxyNotFoundHtml(text) {
  const s = String(text ?? '');
  return /proxy\s*not\s*found/i.test(s) || /<title>\s*Proxy Not Found\s*<\/title>/i.test(s);
}

/**
 * Sustained 502/Bad Gateway from Clore (or similar) edge HTML.
 * @param {number} status
 * @param {string} [text]
 */
export function isBadGatewayResponse(status, text = '') {
  if (Number(status) === 502) return true;
  const s = String(text ?? '');
  return /bad\s*gateway/i.test(s) || /<title>[^<]*502[^<]*<\/title>/i.test(s);
}

/**
 * Default fail-fast budgets for sustained edge errors before walking the next host.
 * Proxy Not Found rarely recovers; 502 often means Comfy still booting (needs longer).
 */
export const HTTP_CUSTOMER_PATH_FAIL_FAST = Object.freeze({
  proxyNotFoundFailMs: 90_000,
  badGatewayFailMs: 180_000,
});

/**
 * @param {string} baseUrl
 * @param {string} path
 * @param {{ method?: string; body?: unknown; timeoutMs?: number }} [opts]
 */
async function fetchComfyJson(baseUrl, path, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: opts.method || 'GET',
      headers: opts.body != null ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      json,
      text: text.slice(0, 400),
      proxyNotFound: isProxyNotFoundHtml(text),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Customer-path hard checks against a public Comfy base URL.
 *
 * @param {string | string[]} baseUrl One URL or candidates (tried in order each poll).
 * @param {{
 *   gpuLine?: string | null;
 *   timeoutMs: number;
 *   pollMs?: number;
 *   proxyNotFoundFailMs?: number;
 *   badGatewayFailMs?: number;
 * }} options Fail-fast budgets for sustained Clore-edge Proxy Not Found / 502.
 * @returns {Promise<{
 *   ok: boolean;
 *   step: 'http_endpoint'|'gpu_stats'|'comfy_smoke';
 *   detail: string;
 *   elapsedMs: number;
 *   steps: Array<{ step: string; ok: boolean; detail?: string; elapsedMs?: number }>;
 * }>}
 */
export async function waitForHttpCustomerPath(baseUrl, options) {
  const started = Date.now();
  const pollMs = Number(options.pollMs) > 0 ? Number(options.pollMs) : 5_000;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 180_000;
  const proxyNotFoundFailMs =
    Number(options.proxyNotFoundFailMs) > 0
      ? Number(options.proxyNotFoundFailMs)
      : HTTP_CUSTOMER_PATH_FAIL_FAST.proxyNotFoundFailMs;
  const badGatewayFailMs =
    Number(options.badGatewayFailMs) > 0
      ? Number(options.badGatewayFailMs)
      : HTTP_CUSTOMER_PATH_FAIL_FAST.badGatewayFailMs;
  const gpuLine = String(options.gpuLine ?? 'rtx3090');
  const bases = (Array.isArray(baseUrl) ? baseUrl : [baseUrl])
    .map((u) => normalizeComfyBaseUrl(u))
    .filter(/** @returns {u is string} */ (u) => Boolean(u));
  /** @type {Array<{ step: string; ok: boolean; detail?: string; elapsedMs?: number }>} */
  const steps = [];

  if (!bases.length) {
    steps.push({ step: 'http_endpoint', ok: false, detail: 'missing comfy base url', elapsedMs: 0 });
    return {
      ok: false,
      step: 'http_endpoint',
      detail: 'http_endpoint: missing comfy base url',
      elapsedMs: 0,
      steps,
    };
  }

  let lastDetail = 'waiting system_stats';
  /** @type {unknown} */
  let lastStats = null;
  /** @type {string} */
  let base = bases[0];
  /** @type {number | null} */
  let proxyNotFoundSince = null;
  /** @type {number | null} */
  let badGatewaySince = null;
  const tStats = Date.now();
  while (Date.now() - started < timeoutMs) {
    let sawProxyNotFound = false;
    let sawBadGateway = false;
    let sawJson = false;
    try {
      for (const candidate of bases) {
        const res = await fetchComfyJson(candidate, '/system_stats', { timeoutMs: 10_000 });
        if (res.proxyNotFound) {
          sawProxyNotFound = true;
          lastDetail = `http_endpoint: Proxy Not Found at ${candidate}`;
          continue;
        }
        if (isBadGatewayResponse(res.status, res.text)) {
          sawBadGateway = true;
          lastDetail = `http_endpoint: status ${res.status} ${res.text}`;
          continue;
        }
        if (res.ok && res.json) {
          sawJson = true;
          lastStats = res.json;
          base = candidate;
          const gpu = parseSystemStatsGpuGate(res.json, gpuLine);
          if (gpu.ok) {
            steps.push({
              step: 'http_endpoint',
              ok: true,
              detail: `reachable ${base}`,
              elapsedMs: Date.now() - tStats,
            });
            steps.push({
              step: 'gpu_stats',
              ok: true,
              detail: gpu.detail,
              elapsedMs: Date.now() - tStats,
            });
            proxyNotFoundSince = null;
            badGatewaySince = null;
            break;
          }
          lastDetail = gpu.detail;
        } else {
          lastDetail = `http_endpoint: status ${res.status} ${res.text}`;
        }
      }
      if (steps.some((s) => s.step === 'gpu_stats' && s.ok)) break;

      // Real JSON (even GPU mismatch) means the edge is wired — reset edge fail-fast clocks.
      if (sawJson || lastStats) {
        proxyNotFoundSince = null;
        badGatewaySince = null;
      } else {
        if (sawProxyNotFound) {
          if (proxyNotFoundSince == null) proxyNotFoundSince = Date.now();
        } else {
          proxyNotFoundSince = null;
        }
        if (sawBadGateway) {
          if (badGatewaySince == null) badGatewaySince = Date.now();
        } else {
          badGatewaySince = null;
        }

        if (
          proxyNotFoundSince != null &&
          Date.now() - proxyNotFoundSince >= proxyNotFoundFailMs
        ) {
          const sec = Math.max(1, Math.round(proxyNotFoundFailMs / 1000));
          lastDetail =
            `http_endpoint: Proxy Not Found for ${sec}s ` +
            `(Clore edge has no backend on ${bases.join(' | ')})`;
          break;
        }
        if (badGatewaySince != null && Date.now() - badGatewaySince >= badGatewayFailMs) {
          const sec = Math.max(1, Math.round(badGatewayFailMs / 1000));
          lastDetail =
            `http_endpoint: status 502 for ${sec}s ` +
            `(sustained Bad Gateway on ${bases.join(' | ')})`;
          break;
        }
      }
    } catch (err) {
      lastDetail = `http_endpoint: ${err instanceof Error ? err.message : String(err)}`;
      proxyNotFoundSince = null;
      badGatewaySince = null;
    }
    await sleep(pollMs);
  }

  if (!steps.some((s) => s.step === 'gpu_stats' && s.ok)) {
    const isReachableFail = /http_endpoint|fetch|econn|abort|proxy not found|status\s+[45]/i.test(
      lastDetail,
    );
    const step = isReachableFail && !lastStats ? 'http_endpoint' : 'gpu_stats';
    steps.push({
      step,
      ok: false,
      detail: lastDetail,
      elapsedMs: Date.now() - started,
    });
    console.info('[gate.http_fail]', { step, detail: lastDetail, base: bases.join(',') });
    return {
      ok: false,
      step,
      detail: lastDetail.startsWith(step) ? lastDetail : `${step}: ${lastDetail}`,
      elapsedMs: Date.now() - started,
      steps,
    };
  }

  const tSmoke = Date.now();
  let smokeDetail = 'waiting prompt smoke';
  const clientId = `gv-gate-${Date.now().toString(36)}`;
  while (Date.now() - started < timeoutMs) {
    try {
      // ComfyUI rejects graphs with no output nodes (prompt_no_outputs).
      // EmptyImage + PreviewImage needs no checkpoint / VAE.
      const body = {
        prompt: {
          '1': {
            class_type: 'EmptyImage',
            inputs: { width: 64, height: 64, batch_size: 1, color: 0 },
          },
          '2': {
            class_type: 'PreviewImage',
            inputs: { images: ['1', 0] },
          },
        },
        client_id: clientId,
      };
      const promptRes = await fetchComfyJson(base, '/prompt', {
        method: 'POST',
        body,
        timeoutMs: 20_000,
      });
      if (!promptRes.ok || !promptRes.json || typeof promptRes.json !== 'object') {
        smokeDetail = `comfy_smoke: prompt status ${promptRes.status} ${promptRes.text}`;
        await sleep(pollMs);
        continue;
      }
      const promptJson = /** @type {Record<string, unknown>} */ (promptRes.json);
      const pid = promptJson.prompt_id ?? promptJson.promptId;
      if (!pid) {
        smokeDetail = `comfy_smoke: no prompt_id ${JSON.stringify(promptJson).slice(0, 200)}`;
        await sleep(pollMs);
        continue;
      }

      const histDeadline = Date.now() + 45_000;
      while (Date.now() < histDeadline && Date.now() - started < timeoutMs) {
        const hist = await fetchComfyJson(base, `/history/${encodeURIComponent(String(pid))}`, {
          timeoutMs: 10_000,
        });
        if (hist.ok && hist.json && typeof hist.json === 'object') {
          const histObj = /** @type {Record<string, unknown>} */ (hist.json);
          if (histObj[String(pid)]) {
            steps.push({
              step: 'comfy_smoke',
              ok: true,
              detail: `prompt ok ${pid}`,
              elapsedMs: Date.now() - tSmoke,
            });
            console.info('[gate.http_pass]', { base, gpuLine, steps });
            return {
              ok: true,
              step: 'comfy_smoke',
              detail: 'http customer-path ok',
              elapsedMs: Date.now() - started,
              steps,
            };
          }
        }
        await sleep(1_000);
      }
      smokeDetail = `comfy_smoke: history timeout for ${pid}`;
    } catch (err) {
      smokeDetail = `comfy_smoke: ${err instanceof Error ? err.message : String(err)}`;
    }
    await sleep(pollMs);
  }

  steps.push({
    step: 'comfy_smoke',
    ok: false,
    detail: smokeDetail,
    elapsedMs: Date.now() - tSmoke,
  });
  console.info('[gate.http_fail]', { step: 'comfy_smoke', detail: smokeDetail, base });
  return {
    ok: false,
    step: 'comfy_smoke',
    detail: smokeDetail,
    elapsedMs: Date.now() - started,
    steps,
  };
}

/**
 * @param {{ sshOk: boolean; sshDetail?: string | null }} input
 */
export function buildGateOpsFlags(input) {
  const sshOk = Boolean(input.sshOk);
  return {
    ssh_ok: sshOk,
    ops_degraded: !sshOk,
    ssh_detail: input.sshDetail != null ? String(input.sshDetail).slice(0, 280) : null,
  };
}
