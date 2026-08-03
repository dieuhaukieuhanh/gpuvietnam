/**
 * Clore L2 provision gate — HTTP customer-path hard, SSH soft (ops_degraded).
 *
 * Do not add Clore-only proxy workarounds here (SSH restart, tunnels, heartbeats).
 * HTTP fail → destroy + walk / failover to Vast. Keep collecting journal data.
 */

import { CLORE_PROVISION_GATE } from '../../gpu-config.js';
import { resolveSshTargetFromClore, sshExec, isSshConfigured } from '../../../machine-ssh.js';
import { resolveClorePublicEndpoints } from './clore-mapper.js';
import {
  buildGateOpsFlags,
  classifyProvisionGateFailReason,
  waitForHttpCustomerPath,
} from '../../provision-http-gate.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const classifyCloreGateFailReason = classifyProvisionGateFailReason;

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
 * Soft SSH probe — never used alone to destroy.
 * @param {*} client CloreClient-like { getOrder }
 * @param {string} orderId
 * @param {string} sshPassword
 * @param {number} timeoutMs
 * @param {number} pollMs
 */
export async function waitForCloreSshReady(client, orderId, sshPassword, timeoutMs, pollMs) {
  if (!sshPassword && !isSshConfigured()) {
    return {
      ok: false,
      detail: 'SSH password missing',
      order: null,
    };
  }
  const started = Date.now();
  const attemptCap = Math.max(
    5_000,
    Number(CLORE_PROVISION_GATE.sshExecAttemptTimeoutMs) || 25_000,
  );
  /** @type {Record<string, unknown> | null} */
  let order = null;
  let lastDetail = 'waiting ssh';

  while (Date.now() - started < timeoutMs) {
    try {
      const live = await client.getOrder(orderId);
      order = live && typeof live === 'object' ? /** @type {Record<string, unknown>} */ (live) : null;
      const target = order
        ? resolveSshTargetFromClore(order, { password: sshPassword || undefined })
        : null;
      if (target?.host && target.port) {
        const withPass = {
          ...target,
          password: sshPassword || target.password || null,
        };
        try {
          const attemptMs = Math.min(attemptCap, Math.max(5_000, timeoutMs));
          const result = await sshExecBounded(
            withPass,
            'echo gpuvietnam_ssh_ok',
            attemptMs,
          );
          const out = String(result?.stdout ?? '');
          if (out.includes('gpuvietnam_ssh_ok')) {
            return { ok: true, detail: 'ssh ready', order, sshTarget: withPass };
          }
          lastDetail = `ssh echo unexpected: ${out.slice(0, 120)}`;
        } catch (err) {
          lastDetail = err instanceof Error ? err.message : String(err);
        }
      } else {
        lastDetail = 'ssh host/port not in order payload yet';
      }
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }
    await sleep(pollMs);
  }

  return { ok: false, detail: `ssh_exec timeout: ${lastDetail}`, order };
}

/**
 * Wait until Clore exposes a public HTTP Comfy URL (http_pub / pub_cluster).
 * @param {*} client
 * @param {string} orderId
 * @param {number} internalPort
 * @param {number} timeoutMs
 * @param {number} pollMs
 * @param {Record<string, unknown> | null} [seedOrder]
 */
export async function waitForCloreEndpointReady(
  client,
  orderId,
  internalPort,
  timeoutMs,
  pollMs,
  seedOrder = null,
) {
  const started = Date.now();
  /** @type {Record<string, unknown> | null} */
  let order = seedOrder;
  let lastDetail = 'waiting http endpoint';

  while (Date.now() - started < timeoutMs) {
    try {
      if (!order) {
        const live = await client.getOrder(orderId);
        order = live && typeof live === 'object' ? /** @type {Record<string, unknown>} */ (live) : null;
      }
      const endpoints = order ? resolveClorePublicEndpoints(order, internalPort) : null;
      if (endpoints?.endpointUrl) {
        return { ok: true, detail: 'http endpoint ready', order, endpoints };
      }
      lastDetail = 'no http_pub/tcp_ports/pub_cluster http url yet';
      const live = await client.getOrder(orderId);
      order = live && typeof live === 'object' ? /** @type {Record<string, unknown>} */ (live) : order;
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }
    await sleep(pollMs);
  }

  return { ok: false, detail: `http_endpoint timeout: ${lastDetail}`, order };
}

/**
 * @param {*} client
 * @param {{
 *   orderId: string;
 *   sshPassword: string;
 *   internalPort?: number;
 *   gpuLine?: string | null;
 * }} input
 */
export async function runCloreProvisionGate(client, input) {
  const cfg = CLORE_PROVISION_GATE;
  const orderId = String(input.orderId);
  const internalPort = Number(input.internalPort) || 8080;
  const gpuLine = String(input.gpuLine ?? 'rtx3090');
  const sshPassword = String(input.sshPassword ?? '');
  const pollMs = cfg.pollMs;
  /** @type {Array<{ step: string; ok: boolean; detail?: string; elapsedMs?: number }>} */
  const steps = [];
  /** @type {Record<string, unknown> | null} */
  let order = null;

  const t0 = Date.now();
  const ports = await waitForCloreEndpointReady(
    client,
    orderId,
    internalPort,
    cfg.portTimeoutMs + cfg.comfyColdStartExtraMs,
    pollMs,
    order,
  );
  order = ports.order ?? order;
  steps.push({
    step: 'http_endpoint',
    ok: Boolean(ports.ok),
    detail: ports.detail,
    elapsedMs: Date.now() - t0,
  });
  if (!ports.ok) {
    return {
      ok: false,
      step: 'http_endpoint',
      detail: ports.detail,
      order,
      steps,
      ops: buildGateOpsFlags({ sshOk: false, sshDetail: 'not probed — http endpoint failed' }),
    };
  }

  const candidates =
    Array.isArray(ports.endpoints?.candidateUrls) && ports.endpoints.candidateUrls.length
      ? ports.endpoints.candidateUrls.map(String)
      : ports.endpoints?.endpointUrl
        ? [String(ports.endpoints.endpointUrl)]
        : [];
  const httpTimeout =
    cfg.comfyWorkflowTimeoutMs + cfg.comfyColdStartExtraMs + cfg.gpuCudaTimeoutMs;
  const t1 = Date.now();
  // Fail-fast edge errors so bad hosts don't burn the full ~5 min HTTP budget:
  // Proxy Not Found ~180s (container boot takes 2-3 min); sustained 502 ~240s (beyond this = real failure).
  const http = await waitForHttpCustomerPath(candidates, {
    gpuLine,
    timeoutMs: httpTimeout,
    pollMs,
    proxyNotFoundFailMs:
      Number(process.env.CLORE_PROXY_NOT_FOUND_FAIL_MS) > 0
        ? Number(process.env.CLORE_PROXY_NOT_FOUND_FAIL_MS)
        : 180_000,  // 3 min — container boot takes 2-3 min before HTTP responds
    badGatewayFailMs:
      Number(process.env.CLORE_BAD_GATEWAY_FAIL_MS) > 0
        ? Number(process.env.CLORE_BAD_GATEWAY_FAIL_MS)
        : 240_000,  // 4 min — sustained 502 beyond this = real failure
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
      order,
      steps,
      ops: buildGateOpsFlags({ sshOk: false, sshDetail: 'not probed — http customer-path failed' }),
    };
  }

  const softMs = Math.max(
    5_000,
    Number(cfg.sshSoftTimeoutMs) || Math.min(Number(cfg.sshReadyTimeoutMs) || 60_000, 60_000),
  );
  const t2 = Date.now();
  const ssh = await waitForCloreSshReady(client, orderId, sshPassword, softMs, pollMs);
  order = ssh.order ?? order;
  steps.push({
    step: 'ssh_exec',
    ok: Boolean(ssh.ok),
    detail: ssh.detail,
    elapsedMs: Date.now() - t2,
  });
  const ops = buildGateOpsFlags({
    sshOk: Boolean(ssh.ok),
    sshDetail: ssh.detail ?? null,
  });
  if (ssh.ok) {
    console.info('[gate.ssh_soft_ok]', { provider: 'clore', orderId });
  } else {
    console.info('[gate.ssh_soft_fail]', {
      provider: 'clore',
      orderId,
      detail: ssh.detail,
    });
  }

  try {
    const live = await client.getOrder(orderId);
    order = live && typeof live === 'object' ? /** @type {Record<string, unknown>} */ (live) : order;
  } catch {
    /* keep */
  }

  console.info('[clore/provision-gate] passed', {
    orderId,
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
    order,
    steps,
    ops,
  };
}
