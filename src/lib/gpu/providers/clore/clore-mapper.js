import { createGPUStatus } from '../../domain/gpu-status.js';
import { DEFAULT_GPU_PORT } from '../../gpu-config.js';

/** @typedef {import('../../domain/gpu-instance').GPUInstance} GPUInstance */
/** @typedef {import('../../domain/gpu-instance').GPULine} GPULine */

export const PROVIDER_ID = 'clore';
export const PROVIDER_NAME = 'Clore.ai';

/**
 * @param {unknown} raw
 * @param {string} [instanceIdHint]
 */
export function normalizeCloreOrderRecord(raw, instanceIdHint) {
  if (!raw || typeof raw !== 'object') {
    return instanceIdHint ? { id: instanceIdHint, order_id: instanceIdHint } : {};
  }
  const record = /** @type {Record<string, unknown>} */ (raw);
  const id = String(record.order_id ?? record.id ?? instanceIdHint ?? '');
  return id ? { ...record, id, order_id: id } : record;
}

/**
 * @param {string} connectionString
 */
export function parseCloreSshConnection(connectionString) {
  const text = String(connectionString ?? '');
  const match = text.match(/ssh\s+\S+@([\w.-]+)\s+-p\s+(\d+)/i);
  if (!match) return { host: null, port: null };
  return { host: match[1], port: Number(match[2]) };
}

/**
 * Clore marketplace maps container ports as `"22:1972"` (local:public).
 * @param {unknown} tcpPorts
 * @returns {Record<string, number>}
 */
export function parseCloreTcpPortMap(tcpPorts) {
  /** @type {Record<string, number>} */
  const map = {};
  if (!Array.isArray(tcpPorts)) return map;
  for (const entry of tcpPorts) {
    const match = String(entry ?? '').match(/^(\d+)\s*:\s*(\d+)$/);
    if (!match) continue;
    const external = Number(match[2]);
    if (Number.isFinite(external) && external > 0) {
      map[match[1]] = external;
    }
  }
  return map;
}

/**
 * Resolve public Comfy/SSH endpoints from Clore order fields
 * (`http_pub`, `pub_cluster`, `tcp_ports`) — not Vast-style `connection.*`.
 * @param {Record<string, unknown>} record
 * @param {number} [internalPort]
 */
export function resolveClorePublicEndpoints(record, internalPort = DEFAULT_GPU_PORT) {
  const connection =
    record.connection && typeof record.connection === 'object'
      ? /** @type {Record<string, unknown>} */ (record.connection)
      : {};
  const ports =
    connection.ports && typeof connection.ports === 'object'
      ? /** @type {Record<string, unknown>} */ (connection.ports)
      : {};

  const tcpMap = parseCloreTcpPortMap(record.tcp_ports);
  const pubCluster = Array.isArray(record.pub_cluster)
    ? record.pub_cluster.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const httpPub = String(record.http_pub ?? '').trim();
  const httpLocal = String(record.http_port ?? internalPort);

  /** @type {string | undefined} */
  let endpointUrl;
  /** @type {number | null} */
  let externalPort = null;
  /** @type {string | null} */
  let publicHost = null;

  /** @type {string[]} */
  const candidateUrls = [];

  if (httpPub) {
    // Clore reverse-proxy hostname (TLS). Use 443 so endpoint-utils treats it as resolved.
    publicHost = httpPub;
    externalPort = 443;
    endpointUrl = 'https://' + httpPub;
    candidateUrls.push(endpointUrl);
  }
  if (pubCluster[0] && tcpMap[httpLocal]) {
    const direct = 'http://' + pubCluster[0] + ':' + tcpMap[httpLocal];
    candidateUrls.push(direct);
    if (!endpointUrl) {
      publicHost = pubCluster[0];
      externalPort = tcpMap[httpLocal];
      endpointUrl = direct;
    }
  }
  if (!endpointUrl) {
    const httpPortEntry = ports[String(internalPort)] ?? ports['8080'] ?? ports['8888'];
    if (typeof httpPortEntry === 'string') {
      const urlMatch = httpPortEntry.match(/(https?:\/\/[^\s]+)/i);
      if (urlMatch) {
        endpointUrl = urlMatch[1].replace(/^tcp:\/\//i, 'http://');
        try {
          const parsed = new URL(
            endpointUrl.startsWith('http') ? endpointUrl : 'http://' + endpointUrl,
          );
          publicHost = parsed.hostname;
          externalPort = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : null);
        } catch {
          /* ignore */
        }
      } else {
        const hostPort = httpPortEntry.match(/([\w.-]+):(\d+)/);
        if (hostPort) {
          publicHost = hostPort[1];
          externalPort = Number(hostPort[2]);
          endpointUrl = 'http://' + publicHost + ':' + externalPort;
          candidateUrls.push(endpointUrl);
        }
      }
      if (endpointUrl) candidateUrls.push(endpointUrl);
    }
  }

  const sshFromConnection = parseCloreSshConnection(String(connection.ssh ?? ''));
  const sshHost = pubCluster[0] ?? sshFromConnection.host;
  const sshPort = tcpMap['22'] ?? sshFromConnection.port;
  if (!publicHost && sshHost) publicHost = sshHost;

  const uniqueCandidates = [...new Set(candidateUrls.filter(Boolean))];

  return {
    endpointUrl,
    /** Prefer http_pub, then direct pub_cluster:tcp when present. */
    candidateUrls: uniqueCandidates.length
      ? uniqueCandidates
      : endpointUrl
        ? [endpointUrl]
        : [],
    externalPort,
    publicHost,
    sshHost: sshHost ?? null,
    sshPort: sshPort ?? null,
  };
}

/**
 * @param {Record<string, unknown>} raw
 * @param {GPULine} gpuLine
 * @param {{ port?: number; selection?: Record<string, unknown>; image?: string | null }} [options]
 * @returns {GPUInstance}
 */
export function mapCloreOrderToGPUInstance(raw, gpuLine, options = {}) {
  const record = normalizeCloreOrderRecord(raw);
  const id = String(record.order_id ?? record.id ?? '');
  const statusRaw = String(record.status ?? '').toLowerCase();
  const online = record.online === true || record.online === 1 || record.online === '1';

  /** @type {import('../../domain/gpu-status').GPUStatusCode} */
  let code = 'starting';
  if (statusRaw.includes('fail') || statusRaw.includes('error')) {
    code = 'failed';
  } else if (
    statusRaw.includes('paused') ||
    statusRaw.includes('expired') ||
    statusRaw.includes('cancel')
  ) {
    code = 'stopped';
  } else if (online || statusRaw.includes('running') || Boolean(record.http_pub)) {
    // Clore often leaves `status` null while `online` + `http_pub` are ready.
    code = 'running';
  } else if (
    !statusRaw ||
    statusRaw === 'null' ||
    statusRaw.includes('pending') ||
    statusRaw.includes('creating')
  ) {
    code = 'starting';
  }

  const internalPort = options.port ?? DEFAULT_GPU_PORT;
  const endpoints = resolveClorePublicEndpoints(record, internalPort);
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
      message: typeof record.error === 'string' ? record.error : undefined,
    }),
    region: typeof record.region === 'string' ? record.region : undefined,
    endpointUrl: endpoints.endpointUrl,
    createdAt: record.created
      ? new Date(Number(record.created) * 1000).toISOString()
      : record.ct
        ? new Date(Number(record.ct) * 1000).toISOString()
        : undefined,
    metadata: {
      clore: record,
      port: endpoints.externalPort,
      internalPort,
      sshHost: endpoints.sshHost,
      sshPort: endpoints.sshPort,
      publicHost: endpoints.publicHost,
      sshPassword:
        typeof record.gpuvietnam_ssh_password === 'string'
          ? record.gpuvietnam_ssh_password
          : null,
      selection: options.selection ?? null,
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
