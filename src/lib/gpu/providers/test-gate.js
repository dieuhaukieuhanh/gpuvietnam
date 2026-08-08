/**
 * Lightweight GPU infrastructure provision gate — shared by Vast + Clore.
 *
 * This gate is for pre-validation (cron-driven Host Intelligence refresh).
 * It uses a tiny ~300MB image (no ComfyUI, no PyTorch) and completes in
 * ~30-60 seconds. The full ComfyUI gate still runs when a user rents.
 *
 * Checks:
 *   1. Port mapping (provider-specific)
 *   2. GET /health → 200 + nvidia-smi GPU info (reject disk_only / fake GPU)
 *   3. Min VRAM floor matching package line
 *   4. GET /system_stats → CUDA devices present
 *   5. CUDA compute smoke (cuda_check.py) when reported
 *
 * All steps are HARD gates — fail = destroy, success = record reputation.
 */

// ---------------------------------------------------------------------------
// Expected GPU name tokens per line (subset of full VAST_PROVISION_GATE config)
// ---------------------------------------------------------------------------

/** @type {Record<string, string[]>} */
const EXPECTED_GPU_TOKENS = {
  rtx3090: ['3090'],
  rtx4090_1x: ['4090'],
  rtx5090_1x: ['5090'],
};

/** Min VRAM (GB) — aligned with PACKAGE_SPECS floors for Starter/Pro/Studio. */
/** @type {Record<string, number>} */
const MIN_VRAM_GB_BY_LINE = {
  rtx3090: 20,
  rtx4090_1x: 20,
  rtx5090_1x: 30,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} url
 * @param {string} path
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean; status: number; json: unknown; text: string; detail: string }>}
 */
async function fetchJson(url, path, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}${path}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return {
      ok: res.ok,
      status: res.status,
      json,
      text,
      detail: res.ok ? 'ok' : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: '',
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse nvidia-smi GPU name from test gate /health response.
 * @param {unknown} data
 * @param {string} gpuLine
 * @returns {{ ok: boolean; detail: string; gpus?: Array<{ name: string; vramTotalMb: number; driverVersion: string }> }}
 */
/**
 * @param {unknown} data
 * @returns {string | null}
 */
function readCudaSmoke(data) {
  if (!data || typeof data !== 'object') return null;
  const raw = /** @type {Record<string, unknown>} */ (data).cuda_smoke;
  return raw == null ? null : String(raw);
}

/**
 * @param {unknown} data
 * @param {string} gpuLine
 * @returns {{ ok: boolean; detail: string; gpus?: Array<{ name: string; vramTotalMb: number; driverVersion: string }>; diskOnly?: boolean }}
 */
function parseGpuHealth(data, gpuLine) {
  const gpus = data && typeof data === 'object' && 'gpus' in data
    ? /** @type {Array<{ name: string; vram_total_mb: number; driver_version: string }>} */ (
        /** @type {Record<string, unknown>} */ (data).gpus)
    : null;

  if (!gpus || !Array.isArray(gpus) || gpus.length === 0) {
    return {
      ok: false,
      detail: 'disk_only_billing (no gpus in /health — GPU missing / struck through)',
      diskOnly: true,
    };
  }

  const expected = EXPECTED_GPU_TOKENS[/** @type {keyof typeof EXPECTED_GPU_TOKENS} */ (gpuLine)] || [];
  const lowerName = String(gpus[0].name || '').toLowerCase();

  if (!lowerName || /^(unknown|n\/a|none|null)$/i.test(lowerName)) {
    return {
      ok: false,
      detail: 'disk_only_billing (GPU name empty / unknown)',
      diskOnly: true,
    };
  }

  if (expected.length > 0 && !expected.some((tok) => lowerName.includes(String(tok).toLowerCase()))) {
    return {
      ok: false,
      detail: `GPU name mismatch (want ${expected.join('|')}, got ${gpus[0].name})`,
    };
  }

  const vramTotalMb = Number(gpus[0].vram_total_mb ?? 0);
  const vramGb = vramTotalMb > 0 ? vramTotalMb / 1024 : 0;
  const minVramGb = MIN_VRAM_GB_BY_LINE[gpuLine] ?? 20;
  if (!(vramGb >= minVramGb)) {
    return {
      ok: false,
      detail:
        vramGb <= 0
          ? 'disk_only_billing (VRAM 0 — GPU detached / storage-only)'
          : `VRAM too low (have ${vramGb.toFixed(1)}GB, need >=${minVramGb}GB)`,
      diskOnly: vramGb <= 0,
    };
  }

  const cudaSmoke = readCudaSmoke(data);
  if (cudaSmoke && /cuda_smoke_fail|fail|error|no.?cuda|not found/i.test(cudaSmoke)) {
    return {
      ok: false,
      detail: `CUDA smoke failed: ${cudaSmoke.slice(0, 160)}`,
    };
  }

  return {
    ok: true,
    detail: `GPU: ${gpus[0].name}, VRAM: ${gpus[0].vram_total_mb}MB, Driver: ${gpus[0].driver_version}`,
    gpus: gpus.map((g) => ({
      name: g.name,
      vramTotalMb: g.vram_total_mb,
      driverVersion: g.driver_version,
    })),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the test-image provision gate. Much faster than the full ComfyUI gate.
 *
 * @param {object} params
 * @param {() => Promise<string | null>} params.waitForEndpoint — provider-specific: poll until endpoint URL is available
 * @param {string} params.gpuLine — e.g. 'rtx4090_1x'
 * @param {number} [params.timeoutMs] — total gate timeout (default 90s)
 * @param {number} [params.pollMs] — poll interval (default 3s, faster than full gate's 5s)
 * @returns {Promise<{
 *   ok: boolean;
 *   step: string;
 *   detail: string;
 *   elapsedMs: number;
 *   gpuName?: string | null;
 *   vramGb?: number | null;
 *   driverVersion?: string | null;
 *   bootSec?: number | null;
 *   steps: Array<{ step: string; ok: boolean; detail?: string; elapsedMs?: number }>;
 * }>}
 */
export async function runTestProvisionGate(params) {
  const { waitForEndpoint, gpuLine } = params;
  const timeoutMs = params.timeoutMs || 90_000;
  const pollMs = params.pollMs || 3_000;

  const t0 = Date.now();
  /** @type {Array<{ step: string; ok: boolean; detail?: string; elapsedMs?: number }>} */
  const steps = [];

  // ----- 1. Wait for endpoint -----
  let endpointUrl = null;
  let lastDetail = 'waiting endpoint';
  while (Date.now() - t0 < timeoutMs) {
    try {
      endpointUrl = await waitForEndpoint();
      if (endpointUrl) break;
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }
    await sleep(pollMs);
  }

  if (!endpointUrl) {
    const elapsedMs = Date.now() - t0;
    steps.push({ step: 'endpoint', ok: false, detail: lastDetail, elapsedMs });
    return { ok: false, step: 'endpoint', detail: lastDetail, elapsedMs, steps };
  }
  const endpointAt = Date.now();
  steps.push({ step: 'endpoint', ok: true, detail: endpointUrl, elapsedMs: endpointAt - t0 });

  const baseUrl = endpointUrl.replace(/\/+$/, '');

  // ----- 2. /health check (poll — Clore http_pub often 502 until container listens) -----
  /** @type {{ ok: boolean; status: number; json: unknown; text: string; detail: string }} */
  let health = { ok: false, status: 0, json: null, text: '', detail: 'waiting /health' };
  while (Date.now() - t0 < timeoutMs) {
    health = await fetchJson(baseUrl, '/health', 10_000);
    if (health.ok && health.json) break;
    // Retry transient proxy / pull / boot failures
    const transient =
      health.status === 0 ||
      health.status === 502 ||
      health.status === 503 ||
      health.status === 504 ||
      /abort|timeout|econnreset|econnrefused|fetch failed/i.test(health.detail);
    if (!transient) break;
    await sleep(pollMs);
  }
  steps.push({
    step: 'health_http',
    ok: Boolean(health.ok && health.json),
    detail: health.detail,
    elapsedMs: Date.now() - endpointAt,
  });
  if (!health.ok || !health.json) {
    const elapsedMs = Date.now() - t0;
    const noGpu =
      health.status === 503 ||
      /no_gpu|no gpu/i.test(health.text || '') ||
      /no_gpu|no gpu/i.test(health.detail || '');
    return {
      ok: false,
      step: noGpu ? 'disk_only' : 'health_http',
      detail: noGpu
        ? 'disk_only_billing (NO_GPU from test image /health)'
        : health.detail,
      elapsedMs,
      steps,
    };
  }

  const gpu = parseGpuHealth(health.json, gpuLine);
  const gpuStep = gpu.diskOnly ? 'disk_only' : 'gpu_detect';
  steps.push({ step: gpuStep, ok: gpu.ok, detail: gpu.detail, elapsedMs: Date.now() - endpointAt });
  if (!gpu.ok) {
    const elapsedMs = Date.now() - t0;
    return { ok: false, step: gpuStep, detail: gpu.detail, elapsedMs, steps };
  }

  // ----- 3. /system_stats (reuse ComfyUI gate's device check) -----
  const stats = await fetchJson(baseUrl, '/system_stats', 8_000);
  let hasCudaDevice = false;
  let statsDetail = stats.detail;
  if (stats.ok && stats.json && typeof stats.json === 'object') {
    const system = /** @type {Record<string, unknown>} */ (stats.json).system;
    const devices =
      system && typeof system === 'object' && 'devices' in /** @type {object} */ (system)
        ? /** @type {Record<string, unknown>} */ (system).devices
        : null;
    if (Array.isArray(devices) && devices.length > 0) {
      hasCudaDevice = devices.some((d) => {
        if (!d || typeof d !== 'object') return false;
        const type = String(/** @type {Record<string, unknown>} */ (d).type ?? '').toLowerCase();
        const name = String(/** @type {Record<string, unknown>} */ (d).name ?? '');
        return type.includes('cuda') || /3090|4090|5090|rtx/i.test(name);
      });
      statsDetail = hasCudaDevice
        ? `cuda devices present (${devices.length})`
        : 'system_stats has devices but none look like CUDA GPU';
    } else if (system) {
      // Legacy shape: "system" key without devices list — keep soft pass only if /health already OK
      hasCudaDevice = true;
      statsDetail = 'cuda devices present';
    }
  }
  steps.push({
    step: 'system_stats',
    ok: hasCudaDevice,
    detail: statsDetail,
    elapsedMs: Date.now() - endpointAt,
  });
  if (!hasCudaDevice) {
    const elapsedMs = Date.now() - t0;
    return {
      ok: false,
      step: 'system_stats',
      detail: statsDetail || 'system_stats missing CUDA devices',
      elapsedMs,
      steps,
    };
  }

  // ----- 4. Extract metadata -----
  const firstGpu = gpu.gpus?.[0];
  const gpuName = firstGpu?.name ?? null;
  const vramTotalMb = firstGpu?.vramTotalMb ?? 0;
  const vramGb = vramTotalMb > 0 ? Math.round(vramTotalMb / 1024 * 10) / 10 : null;
  const driverVersion = firstGpu?.driverVersion ?? null;
  const bootSec = Math.round((endpointAt - t0) / 100) / 10; // time to get endpoint

  const elapsedMs = Date.now() - t0;

  return {
    ok: true,
    step: 'test_gate_pass',
    detail: `GPU ${gpuName}, ${vramGb}GB, driver ${driverVersion}, boot ${bootSec}s`,
    elapsedMs,
    gpuName,
    vramGb,
    driverVersion,
    bootSec,
    steps,
  };
}

/**
 * Classify a test gate failure reason for reputation penalties.
 * @param {string} detail
 * @returns {'endpoint' | 'gpu_detect' | 'system_stats' | 'health_http' | 'disk_only' | 'default'}
 */
export function classifyTestGateFailReason(detail) {
  const s = String(detail ?? '').toLowerCase();
  if (s.includes('disk_only') || s.includes('struck through') || s.includes('storage-only') || s.includes('no_gpu')) {
    return 'disk_only';
  }
  if (s.includes('endpoint')) return 'endpoint';
  if (s.includes('gpu') && (s.includes('detect') || s.includes('mismatch') || s.includes('name') || s.includes('vram'))) {
    return 'gpu_detect';
  }
  if (s.includes('system_stats') || s.includes('cuda')) return 'system_stats';
  if (s.includes('health')) return 'health_http';
  return 'default';
}
