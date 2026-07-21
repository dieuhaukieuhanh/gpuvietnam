/**
 * Vast L2 provision gate — HTTP customer-path hard, SSH soft (ops_degraded).
 * Legacy SSH probes (nvidia-smi / CUDA / localhost Comfy) kept as exports for tests / deep ops.
 */

import { VAST_PROVISION_GATE } from '../../gpu-config.js';
import {
  isSshKeyConfigured,
  resolveSshTargetFromVast,
  sshExec,
} from '../../../machine-ssh.js';
import {
  isVastBadHostStatus,
  isVastInstanceProvisionProgress,
  unwrapVastInstanceRecord,
} from './vast-offer-sanity.js';
import { resolveVastEndpoint } from './vast-endpoint-resolver.js';
import {
  buildGateOpsFlags,
  classifyProvisionGateFailReason,
  waitForHttpCustomerPath,
} from '../../provision-http-gate.js';

/**
 * @typedef {{
 *   step: string;
 *   ok: boolean;
 *   detail?: string;
 *   elapsedMs?: number;
 * }} GateStepResult
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} reason
 * @returns {ReturnType<typeof classifyProvisionGateFailReason>}
 */
export function classifyVastGateFailReason(reason) {
  return classifyProvisionGateFailReason(reason);
}

/**
 * @param {string} stdout
 * @param {string} gpuLine
 * @param {typeof VAST_PROVISION_GATE} [cfg]
 */
export function parseNvidiaSmiGate(stdout, gpuLine, cfg = VAST_PROVISION_GATE) {
  const text = String(stdout ?? '').trim();
  if (!text) return { ok: false, detail: 'nvidia-smi empty output' };
  const lower = text.toLowerCase();
  if (/nvidia-smi.*not found|failed to initialize|no devices|err/.test(lower) && !/geforce|rtx|tesla|quadro/.test(lower)) {
    return { ok: false, detail: `nvidia-smi error: ${text.slice(0, 200)}` };
  }
  const expected =
    cfg.expectedGpuNameByLine[/** @type {keyof typeof cfg.expectedGpuNameByLine} */ (gpuLine)] || [];
  if (expected.length && !expected.some((tok) => lower.includes(String(tok).toLowerCase()))) {
    return { ok: false, detail: `GPU name mismatch (want ${expected.join('|')}): ${text.slice(0, 200)}` };
  }
  return { ok: true, detail: text.split('\n')[0].slice(0, 200) };
}

/**
 * @param {import('../../../machine-ssh.js').SshTarget} sshTarget
 * @param {string} command
 * @param {number} timeoutMs
 */
async function sshExecBounded(sshTarget, command, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      sshExec(sshTarget, command),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`ssh exec timeout ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * @param {*} client VastClient-like { getInstance }
 * @param {string} instanceId
 * @param {number} timeoutMs
 * @param {number} pollMs
 */
export async function waitForVastSshReady(client, instanceId, timeoutMs, pollMs) {
  if (!isSshKeyConfigured()) {
    return {
      ok: false,
      detail: 'SSH not configured (VAST_SSH_PRIVATE_KEY)',
      live: null,
    };
  }
  const started = Date.now();
  /** @type {Record<string, unknown> | null} */
  let live = null;
  let lastDetail = 'waiting ssh';

  while (Date.now() - started < timeoutMs) {
    try {
      const raw = await client.getInstance(instanceId);
      live = unwrapVastInstanceRecord(
        raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : null,
      );
      if (isVastBadHostStatus(live)) {
        return {
          ok: false,
          detail: String(live?.status_msg ?? live?.actual_status ?? 'bad status'),
          live,
        };
      }
      const target = live ? resolveSshTargetFromVast(live) : null;
      if (target) {
        try {
          const result = await sshExecBounded(target, 'echo gpuvietnam_ssh_ok', Math.min(15_000, timeoutMs));
          const out = String(result?.stdout ?? result ?? '');
          if (out.includes('gpuvietnam_ssh_ok')) {
            return { ok: true, detail: 'ssh ready', live, sshTarget: target };
          }
          lastDetail = `ssh echo unexpected: ${out.slice(0, 120)}`;
        } catch (err) {
          lastDetail = err instanceof Error ? err.message : String(err);
        }
      } else {
        lastDetail = 'ssh host/port not in instance payload yet';
      }
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }
    await sleep(pollMs);
  }

  return {
    ok: false,
    detail: `ssh_exec timeout: ${lastDetail}`,
    live,
  };
}

/**
 * @param {*} client
 * @param {string} instanceId
 * @param {number} internalPort
 * @param {number} timeoutMs
 * @param {number} pollMs
 */
export async function waitForVastPortsReady(client, instanceId, internalPort, timeoutMs, pollMs) {
  const started = Date.now();
  /** @type {Record<string, unknown> | null} */
  let live = null;
  let lastDetail = 'waiting ports';

  while (Date.now() - started < timeoutMs) {
    try {
      const raw = await client.getInstance(instanceId);
      live = unwrapVastInstanceRecord(
        raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : null,
      );
      if (isVastBadHostStatus(live)) {
        return {
          ok: false,
          detail: String(live?.status_msg ?? live?.actual_status ?? 'bad status'),
          live,
        };
      }
      if (isVastInstanceProvisionProgress(live, internalPort)) {
        return { ok: true, detail: 'ports mapped', live };
      }
      lastDetail = String(live?.status_msg ?? live?.actual_status ?? 'no ports yet');
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }
    await sleep(pollMs);
  }

  const ip =
    (typeof live?.public_ipaddr === 'string' && live.public_ipaddr) ||
    (typeof live?.public_ip === 'string' && live.public_ip) ||
    null;
  const ports = live?.ports ?? live?.actual_ports;
  const hasPorts =
    ports && typeof ports === 'object' && Object.keys(/** @type {object} */ (ports)).length > 0;
  if (ip && !hasPorts) {
    return { ok: false, detail: 'timeout with IP but no mapped ports', live };
  }
  return { ok: false, detail: `port timeout: ${lastDetail}`, live };
}

/**
 * @param {import('../../../machine-ssh.js').SshTarget} sshTarget
 * @param {string} gpuLine
 * @param {number} budgetMs
 */
export async function runVastNvidiaSmiCheck(sshTarget, gpuLine, budgetMs) {
  const started = Date.now();
  try {
    const result = await sshExecBounded(
      sshTarget,
      'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader',
      budgetMs,
    );
    const stdout = String(result?.stdout ?? result ?? '');
    const parsed = parseNvidiaSmiGate(stdout, gpuLine);
    return {
      ...parsed,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - started,
    };
  }
}

/**
 * @param {string} source
 * @returns {string}
 */
function pythonViaBase64(source) {
  const b64 = Buffer.from(source, 'utf8').toString('base64');
  return `echo '${b64}' | base64 -d | python3`;
}

/**
 * @param {import('../../../machine-ssh.js').SshTarget} sshTarget
 * @param {number} budgetMs
 */
export async function runVastCudaSmoke(sshTarget, budgetMs) {
  const started = Date.now();
  const py = [
    'import torch',
    'assert torch.cuda.is_available(), "cuda_unavailable"',
    'x = torch.mm(torch.randn(64, 64, device="cuda"), torch.randn(64, 64, device="cuda"))',
    'print("CUDA_SMOKE_OK", float(x.sum().item()), torch.cuda.get_device_name(0))',
  ].join('\n');
  try {
    const result = await sshExecBounded(sshTarget, pythonViaBase64(py), budgetMs);
    const stdout = String(result?.stdout ?? '');
    const stderr = String(result?.stderr ?? '');
    if (!stdout.includes('CUDA_SMOKE_OK')) {
      return {
        ok: false,
        detail: `cuda smoke failed: ${(stdout + stderr).slice(0, 300)}`,
        elapsedMs: Date.now() - started,
      };
    }
    return { ok: true, detail: stdout.trim().slice(0, 200), elapsedMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - started,
    };
  }
}

/**
 * Comfy READY: /system_stats shows CUDA device + prompt queue accepts a job.
 * Uses SSH localhost so we do not depend on public URL firewall.
 * @param {import('../../../machine-ssh.js').SshTarget} sshTarget
 * @param {number} internalPort
 * @param {number} timeoutMs
 * @param {number} pollMs
 */
export async function waitForVastComfyWorkflowReady(sshTarget, internalPort, timeoutMs, pollMs) {
  const started = Date.now();
  let lastDetail = 'waiting comfy';
  const port = Number(internalPort) || 8080;

  const py = `
import json, urllib.request, time, uuid, sys
base = "http://127.0.0.1:${port}"
try:
  stats = json.load(urllib.request.urlopen(base + "/system_stats", timeout=8))
except Exception as e:
  print("COMFY_WAIT", type(e).__name__, str(e)[:160])
  sys.exit(2)
devices = stats.get("devices") or []
if isinstance(devices, dict):
  devices = list(devices.values()) if devices else []
cuda_ok = False
for d in devices:
  if not isinstance(d, dict):
    continue
  t = str(d.get("type") or d.get("name") or "").lower()
  vram = float(d.get("vram_total", 0) or d.get("vram_total_gb", 0) or 0)
  if "cuda" in t or "nvidia" in t or vram > 0:
    cuda_ok = True
    break
if not cuda_ok:
  print("COMFY_NO_CUDA", json.dumps(devices)[:240])
  sys.exit(3)
prompt = {
  "1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 0}},
  "2": {"class_type": "PreviewImage", "inputs": {"images": ["1", 0]}},
}
body = json.dumps({"prompt": prompt, "client_id": str(uuid.uuid4())}).encode()
req = urllib.request.Request(base + "/prompt", data=body, headers={"Content-Type": "application/json"})
try:
  resp = json.load(urllib.request.urlopen(req, timeout=15))
except Exception as e:
  print("COMFY_PROMPT_FAIL", type(e).__name__, str(e)[:160])
  sys.exit(4)
pid = resp.get("prompt_id") or resp.get("promptId")
if not pid:
  print("COMFY_PROMPT_NO_ID", json.dumps(resp)[:200])
  sys.exit(5)
deadline = time.time() + 45
while time.time() < deadline:
  try:
    hist = json.load(urllib.request.urlopen(base + "/history/" + str(pid), timeout=8))
  except Exception:
    time.sleep(1)
    continue
  entry = hist.get(str(pid)) if isinstance(hist, dict) else None
  if entry:
    print("COMFY_WORKFLOW_OK", pid)
    sys.exit(0)
  time.sleep(1)
print("COMFY_HISTORY_TIMEOUT", pid)
sys.exit(6)
`.trim();

  while (Date.now() - started < timeoutMs) {
    try {
      const result = await sshExecBounded(
        sshTarget,
        pythonViaBase64(py),
        Math.min(60_000, timeoutMs),
      );
      const stdout = String(result?.stdout ?? '');
      const stderr = String(result?.stderr ?? '');
      const combined = `${stdout}\n${stderr}`;
      if (combined.includes('COMFY_WORKFLOW_OK')) {
        return { ok: true, detail: 'comfy workflow ok', elapsedMs: Date.now() - started };
      }
      lastDetail = combined.trim().slice(0, 280) || 'comfy check incomplete';
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }
    await sleep(pollMs);
  }

  return {
    ok: false,
    detail: `comfy_workflow timeout: ${lastDetail}`,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Full Vast L2 gate. Hard = public HTTP; SSH soft → ops flags (never sole destroy reason).
 *
 * @param {*} client
 * @param {{
 *   instanceId: string;
 *   internalPort?: number;
 *   gpuLine?: string | null;
 *   expectedGpuName?: string | null;
 * }} input
 */
export async function runVastProvisionGate(client, input) {
  const cfg = VAST_PROVISION_GATE;
  const instanceId = String(input.instanceId);
  const internalPort = Number(input.internalPort) || 8080;
  const gpuLine = String(input.gpuLine ?? 'rtx3090');
  const pollMs = cfg.pollMs;
  /** @type {GateStepResult[]} */
  const steps = [];
  /** @type {Record<string, unknown> | null} */
  let live = null;

  const t0 = Date.now();
  const ports = await waitForVastPortsReady(
    client,
    instanceId,
    internalPort,
    cfg.portTimeoutMs + cfg.comfyColdStartExtraMs,
    pollMs,
  );
  live = ports.live ?? live;
  steps.push({
    step: 'port',
    ok: Boolean(ports.ok),
    detail: ports.detail,
    elapsedMs: Date.now() - t0,
  });
  if (!ports.ok) {
    return {
      ok: false,
      step: 'http_endpoint',
      detail: ports.detail,
      live,
      steps,
      ops: buildGateOpsFlags({ sshOk: false, sshDetail: 'not probed — port mapping failed' }),
    };
  }

  let baseUrl = null;
  try {
    const resolved = await resolveVastEndpoint(client, instanceId, internalPort, live);
    if (resolved?.status === 'resolved' && resolved.endpoint?.url) {
      baseUrl = resolved.endpoint.url;
    }
  } catch (err) {
    steps.push({
      step: 'http_endpoint',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      elapsedMs: 0,
    });
  }
  if (!baseUrl) {
    return {
      ok: false,
      step: 'http_endpoint',
      detail: 'http_endpoint: could not resolve public Comfy URL',
      live,
      steps,
      ops: buildGateOpsFlags({ sshOk: false, sshDetail: 'not probed — no public url' }),
    };
  }

  const httpTimeout =
    cfg.comfyWorkflowTimeoutMs + cfg.comfyColdStartExtraMs + cfg.gpuCudaTimeoutMs;
  const http = await waitForHttpCustomerPath(baseUrl, {
    gpuLine,
    timeoutMs: httpTimeout,
    pollMs,
  });
  for (const s of http.steps) {
    if (!steps.some((x) => x.step === s.step && x.ok === s.ok && x.detail === s.detail)) {
      steps.push(s);
    }
  }
  if (!http.ok) {
    return {
      ok: false,
      step: http.step,
      detail: http.detail,
      live,
      steps,
      ops: buildGateOpsFlags({ sshOk: false, sshDetail: 'not probed — http customer-path failed' }),
    };
  }

  const softMs = Math.max(
    5_000,
    Number(cfg.sshSoftTimeoutMs) || Math.min(Number(cfg.sshReadyTimeoutMs) || 30_000, 30_000),
  );
  const tSsh = Date.now();
  const ssh = await waitForVastSshReady(client, instanceId, softMs, pollMs);
  live = ssh.live ?? live;
  steps.push({
    step: 'ssh_exec',
    ok: Boolean(ssh.ok),
    detail: ssh.detail,
    elapsedMs: Date.now() - tSsh,
  });
  const ops = buildGateOpsFlags({
    sshOk: Boolean(ssh.ok),
    sshDetail: ssh.detail ?? null,
  });
  if (ssh.ok) {
    console.info('[gate.ssh_soft_ok]', { provider: 'vast', instanceId });
  } else {
    console.info('[gate.ssh_soft_fail]', {
      provider: 'vast',
      instanceId,
      detail: ssh.detail,
    });
  }

  try {
    const raw = await client.getInstance(instanceId);
    live = unwrapVastInstanceRecord(
      raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : null,
    );
  } catch {
    /* keep last live */
  }

  console.info('[vast/provision-gate] passed', {
    instanceId,
    gpuLine,
    ops,
    steps: steps.map((s) => `${s.step}:${s.ok ? 'ok' : 'fail'}:${s.elapsedMs ?? 0}ms`),
  });

  return {
    ok: true,
    step: 'comfy_smoke',
    detail: ops.ops_degraded
      ? 'http customer-path ok; ssh soft-fail (ops_degraded)'
      : 'http customer-path ok; ssh ok',
    live,
    steps,
    ops,
  };
}
