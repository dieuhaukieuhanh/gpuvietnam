import { normalizeVastInstanceRecord } from './vast-mapper.js';

export const ENDPOINT_HEALTH_TRUST_WINDOW_MS = 10 * 60 * 1000;
export const ENDPOINT_HARD_TTL_MS = 30 * 60 * 1000;

function readPublicIp(record) {
  if (!record || typeof record !== 'object') return null;
  const ip =
    record.public_ipaddr ??
    record.public_ip ??
    (typeof record.ssh_host === 'string' ? record.ssh_host : undefined);
  return typeof ip === 'string' && ip.length > 0 ? ip : null;
}

export function extractHostPortFromV1Record(v1Record, internalPort) {
  if (!v1Record || typeof v1Record !== 'object') return null;
  const ports = v1Record.ports;
  if (!ports || typeof ports !== 'object' || Array.isArray(ports)) return null;
  const preferredKey = `${internalPort}/tcp`;
  let binding = ports[preferredKey];
  if (!binding) {
    for (const [key, value] of Object.entries(ports)) {
      if (String(key).includes(String(internalPort))) {
        binding = value;
        break;
      }
    }
  }
  if (!binding) return null;
  const entry = Array.isArray(binding) ? binding[0] : binding;
  if (!entry || typeof entry !== 'object') return null;
  const hostPort = Number(entry.HostPort);
  return Number.isFinite(hostPort) && hostPort > 0 ? hostPort : null;
}

export function extractDirectPortFromV0Record(v0Record) {
  if (!v0Record || typeof v0Record !== 'object') return null;
  const directPort = Number(v0Record.direct_port_start);
  return Number.isFinite(directPort) && directPort > 0 ? directPort : null;
}

export function buildResolvedEndpoint(host, externalPort, internalPort, source, resolvedAt = Date.now()) {
  return {
    host,
    externalPort,
    internalPort,
    url: `http://${host}:${externalPort}`,
    source,
    resolvedAt,
  };
}

export function isEndpointCacheTrusted(cache, now = Date.now()) {
  if (!cache || cache.source === 'unresolved') return false;
  if (!cache.trusted || cache.lastHealthOkAt == null) return false;
  if (now - cache.lastHealthOkAt > ENDPOINT_HEALTH_TRUST_WINDOW_MS) return false;
  if (now - cache.resolvedAt > ENDPOINT_HARD_TTL_MS) return false;
  return true;
}

export function shouldRefreshEndpointCache(cache, options = {}) {
  const now = options.now ?? Date.now();
  if (!cache) return true;
  if (options.force) return true;
  if (options.portChanged) return true;
  if (cache.source === 'unresolved') return true;
  if (now - cache.resolvedAt > ENDPOINT_HARD_TTL_MS) return true;
  if (!isEndpointCacheTrusted(cache, now)) return true;
  return false;
}

export function createCachedEndpoint(endpoint) {
  return {
    url: endpoint.url,
    host: endpoint.host,
    externalPort: endpoint.externalPort,
    internalPort: endpoint.internalPort,
    source: endpoint.source,
    resolvedAt: endpoint.resolvedAt,
    trusted: false,
    lastHealthOkAt: null,
  };
}

export function markEndpointCacheHealthOk(cache, now = Date.now()) {
  cache.trusted = true;
  cache.lastHealthOkAt = now;
}

export function invalidateEndpointCacheTrust(cache) {
  cache.trusted = false;
  cache.lastHealthOkAt = null;
}

export async function resolveVastEndpoint(client, instanceId, internalPort, v0Payload) {
  const v1Record = await client.listInstanceV1(instanceId);
  const v0Record = normalizeVastInstanceRecord(
    v0Payload ?? (await client.getInstance(instanceId)),
    instanceId,
  );

  const host = readPublicIp(v1Record) ?? readPublicIp(v0Record);
  const hostPort = extractHostPortFromV1Record(v1Record, internalPort);
  if (host && hostPort != null) {
    return {
      status: 'resolved',
      endpoint: buildResolvedEndpoint(host, hostPort, internalPort, 'v1-hostport'),
    };
  }

  const directPort = extractDirectPortFromV0Record(v0Record);
  if (host && directPort != null) {
    return {
      status: 'resolved',
      endpoint: buildResolvedEndpoint(host, directPort, internalPort, 'v0-direct-port'),
    };
  }

  return {
    status: 'pending',
    host,
    internalPort,
  };
}
