import { createGPUStatus } from '../../domain/gpu-status.js';
import { DEFAULT_GPU_PORT } from '../../gpu-config.js';

/** @typedef {import('../../domain/gpu-instance').GPUInstance} GPUInstance */
/** @typedef {import('../../domain/gpu-instance').GPULine} GPULine */
/** @typedef {import('../../domain/gpu-job').GPUJob} GPUJob */
/** @typedef {import('../../domain/gpu-status').GPUStatus} GPUStatus */

const PROVIDER_ID = 'vast';
const PROVIDER_NAME = 'Vast.ai';

/**
 * Vast returns different shapes: rent `{ new_contract }`, status `{ instances: {...} }`, or flat instance.
 * @param {unknown} raw
 * @param {string} [instanceIdHint]
 * @returns {Record<string, unknown>}
 */
export function normalizeVastInstanceRecord(raw, instanceIdHint) {
  if (!raw || typeof raw !== 'object') {
    return instanceIdHint ? { id: instanceIdHint, instance_id: instanceIdHint } : {};
  }

  const record = /** @type {Record<string, unknown>} */ (raw);

  if (record.instances && typeof record.instances === 'object') {
    const nested = Array.isArray(record.instances)
      ? record.instances[0]
      : record.instances;
    if (nested && typeof nested === 'object') {
      const instance = /** @type {Record<string, unknown>} */ (nested);
      const id = String(instance.id ?? instance.instance_id ?? instanceIdHint ?? '');
      return { ...instance, id, instance_id: id };
    }
  }

  if (record.new_contract != null) {
    const id = String(record.new_contract);
    return { ...record, id, instance_id: id };
  }

  const id = String(record.id ?? record.instance_id ?? instanceIdHint ?? '');
  return id ? { ...record, id, instance_id: id } : record;
}

/**
 * @param {GPULine} gpuLine
 */
export function mapGpuLineToVastSearch(gpuLine) {
  return gpuLine;
}

/**
 * @param {Record<string, unknown>} raw
 * @param {GPULine} gpuLine
 * @param {{ port?: number; instanceIdHint?: string; resolvedEndpoint?: import('./vast-endpoint-resolver.js').ResolvedEndpointPayload | null; image?: string | null }} [options]
 * @returns {GPUInstance}
 */
export function mapVastInstanceToGPUInstance(raw, gpuLine, options = {}) {
  const record = normalizeVastInstanceRecord(raw, options.instanceIdHint);
  const id = String(record.id ?? record.instance_id ?? record.new_contract ?? '');
  const actualStatus = String(
    record.actual_status ?? record.cur_state ?? record.status ?? 'unknown',
  ).toLowerCase();
  const statusMsg = typeof record.status_msg === 'string' ? record.status_msg.toLowerCase() : '';

  /** @type {import('../../domain/gpu-status').GPUStatusCode} */
  let code = 'unknown';
  if (actualStatus.includes('running')) code = 'running';
  else if (actualStatus.includes('loading') || actualStatus.includes('starting')) code = 'starting';
  else if (actualStatus.includes('exited') || actualStatus.includes('stopped')) {
    // Vast "stopped" = disk-only billing, no GPU — treat as failed workstation.
    code = 'failed';
  } else if (actualStatus.includes('failed')) code = 'failed';
  else if (
    /no such container|cannot find container|nvidia-smi|no nvidia|gpu not (found|available)|failed to (create|start) container/i.test(
      statusMsg,
    )
  ) {
    code = 'failed';
  } else if (statusMsg.includes('successfully loaded')) code = 'starting';

  const internalPort = options.port ?? DEFAULT_GPU_PORT;
  const resolved = options.resolvedEndpoint ?? null;
  const endpointUrl = resolved?.url;
  const externalPort = resolved?.externalPort ?? null;
  const image =
    (options.image != null && String(options.image).trim()) ||
    (record.image != null ? String(record.image).trim() : '') ||
    null;

  return {
    id,
    providerId: PROVIDER_ID,
    providerName: PROVIDER_NAME,
    gpuLine,
    status: createGPUStatus(code, {
      healthy: code === 'running',
      message: typeof record.status_msg === 'string' ? record.status_msg : undefined,
    }),
    region: typeof record.geolocation === 'string' ? record.geolocation : undefined,
    endpointUrl,
    createdAt: record.start_date
      ? new Date(Number(record.start_date) * 1000).toISOString()
      : undefined,
    metadata: {
      vast: record,
      port: externalPort,
      internalPort,
      resolvedSource: resolved?.source ?? null,
      image,
      sshOk:
        record.gpuvietnam_ops &&
        typeof record.gpuvietnam_ops === 'object' &&
        typeof /** @type {Record<string, unknown>} */ (record.gpuvietnam_ops).ssh_ok === 'boolean'
          ? Boolean(/** @type {Record<string, unknown>} */ (record.gpuvietnam_ops).ssh_ok)
          : null,
      opsDegraded:
        record.gpuvietnam_ops &&
        typeof record.gpuvietnam_ops === 'object' &&
        /** @type {Record<string, unknown>} */ (record.gpuvietnam_ops).ops_degraded === true,
    },
  };
}

/**
 * @param {Record<string, unknown>} record
 * @param {number} defaultPort
 */
export function resolveVastComfyPort(record, defaultPort) {
  const directPort = Number(record.direct_port_start);
  if (Number.isFinite(directPort) && directPort > 0) {
    return directPort;
  }

  const ports = record.ports;
  if (ports && typeof ports === 'object') {
    for (const [key, value] of Object.entries(ports)) {
      const hostPort = Number(
        /** @type {{ HostPort?: number }} */ (Array.isArray(value) ? value[0] : value)?.HostPort,
      );
      if (Number.isFinite(hostPort) && hostPort > 0) {
        if (String(key).includes(String(defaultPort)) || hostPort === defaultPort) {
          return hostPort;
        }
      }
    }
  }

  return null;
}

/**
 * @param {GPUInstance} instance
 * @param {number} [defaultPort]
 */
export function parseGpuInstanceEndpoint(instance, defaultPort = DEFAULT_GPU_PORT) {
  if (instance.endpointUrl) {
    try {
      const url = new URL(instance.endpointUrl);
      const port =
        Number(url.port) ||
        (url.protocol === 'https:' ? 443 : url.protocol === 'http:' ? 80 : defaultPort);
      return {
        ip: url.hostname,
        port,
        comfyUrl: instance.endpointUrl,
      };
    } catch {
      // fall through
    }
  }

  const cloreMeta = instance.metadata?.clore;
  const cloreHost =
    typeof instance.metadata?.publicHost === 'string'
      ? instance.metadata.publicHost
      : null;
  const clorePort = Number(instance.metadata?.port);
  if (cloreHost && Number.isFinite(clorePort) && clorePort > 0) {
    const comfyUrl =
      clorePort === 443
        ? `https://${cloreHost}`
        : clorePort === 80
          ? `http://${cloreHost}`
          : `http://${cloreHost}:${clorePort}`;
    return { ip: cloreHost, port: clorePort, comfyUrl };
  }
  if (cloreMeta && typeof cloreMeta === 'object' && typeof cloreMeta.http_pub === 'string' && cloreMeta.http_pub) {
    return {
      ip: String(cloreMeta.http_pub),
      port: 443,
      comfyUrl: `https://${cloreMeta.http_pub}`,
    };
  }

  const vast = instance.metadata?.vast;
  const ip =
    typeof vast?.public_ipaddr === 'string'
      ? vast.public_ipaddr
      : typeof vast?.public_ip === 'string'
        ? vast.public_ip
        : typeof vast?.ssh_host === 'string'
          ? vast.ssh_host
          : null;
  const externalPort = Number(instance.metadata?.port);
  const mappedPort =
    vast && typeof vast === 'object'
      ? resolveVastComfyPort(/** @type {Record<string, unknown>} */ (vast), defaultPort)
      : null;
  const port = Number.isFinite(externalPort) && externalPort > 0
    ? externalPort
    : mappedPort;

  if (!ip || !Number.isFinite(port) || port <= 0) {
    return { ip: ip ?? null, port: null, comfyUrl: null };
  }

  const comfyUrl = `http://${ip}:${port}`;
  return { ip, port, comfyUrl };
}

/**
 * @param {Record<string, unknown>} promptResponse
 * @param {string} instanceId
 * @returns {GPUJob}
 */
export function mapComfyPromptToGPUJob(promptResponse, instanceId) {
  const promptId = String(promptResponse?.prompt_id ?? promptResponse?.number ?? '');
  return {
    id: promptId,
    instanceId,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
}

/**
 * @param {Record<string, unknown>} historyEntry
 * @param {string} instanceId
 * @param {string} jobId
 * @returns {GPUJob}
 */
export function mapComfyHistoryToGPUJob(historyEntry, instanceId, jobId) {
  const status = historyEntry?.status;
  const completed = Boolean(status?.completed);
  const failed = Array.isArray(status?.status_str) && status.status_str.includes('error');

  /** @type {import('../../domain/gpu-job').GPUJobStatus} */
  let jobStatus = 'running';
  if (failed) jobStatus = 'failed';
  else if (completed) jobStatus = 'completed';

  return {
    id: jobId,
    instanceId,
    status: jobStatus,
    errorMessage: failed ? String(status?.status_str ?? 'Workflow failed') : undefined,
    completedAt: completed ? new Date().toISOString() : undefined,
  };
}

/**
 * @param {unknown} healthPayload
 * @returns {GPUStatus}
 */
export function mapComfyHealthToGPUStatus(healthPayload) {
  // Reject Clore proxy bootstrap text / non-JSON bodies that used to look "ok".
  if (typeof healthPayload === 'string') {
    const text = healthPayload.trim();
    const starting = /proxy is starting/i.test(text);
    return createGPUStatus(starting ? 'starting' : 'failed', {
      healthy: false,
      message: starting ? 'Proxy is starting' : text.slice(0, 160) || 'ComfyUI unreachable',
    });
  }
  if (!healthPayload || typeof healthPayload !== 'object') {
    return createGPUStatus('failed', {
      healthy: false,
      message: 'ComfyUI unreachable',
    });
  }
  const rec = /** @type {Record<string, unknown>} */ (healthPayload);
  const looksReady = Boolean(
    rec.system || rec.devices || rec.device || rec.comfyui_version != null,
  );
  if (!looksReady) {
    return createGPUStatus('starting', {
      healthy: false,
      message: 'ComfyUI starting',
    });
  }
  return createGPUStatus('running', {
    healthy: true,
    message: 'ComfyUI reachable',
  });
}

export { PROVIDER_ID, PROVIDER_NAME };
