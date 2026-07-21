/**
 * Architecture Freeze v3.2 - external endpoint projection helpers.
 * Internal container port only; never used as external URL fallback.
 */

import { DEFAULT_GPU_PORT } from './gpu/gpu-config.js';

/** Container Comfy port (rent env). Not a valid external HostPort on shared-IP Vast. */
export const INTERNAL_CONTAINER_PORT = DEFAULT_GPU_PORT;

function readIp(source) {
  if (!source || typeof source !== 'object') return null;
  if (typeof source.ip_address === 'string' && source.ip_address.length > 0) {
    return source.ip_address;
  }
  if (typeof source.ip === 'string' && source.ip.length > 0) {
    return source.ip;
  }
  return null;
}

function normalizeExternalPort(port) {
  if (port === null || port === undefined) return null;
  const value = Number(port);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function isEndpointPending(source) {
  if (!source || typeof source !== 'object') return true;
  const port = normalizeExternalPort(source.port);
  return port === null;
}

export function isEndpointDestroyed(machine) {
  return String(machine?.status ?? '').toLowerCase() === 'destroyed';
}

export function isEndpointResolved(source) {
  const ip = readIp(source);
  const port = normalizeExternalPort(source?.port);
  if (!ip || port === null) return false;
  if (port === INTERNAL_CONTAINER_PORT) return false;
  return true;
}

/** @param {unknown} healthOk */
export function isHealthOk(healthOk) {
  return healthOk === true;
}

/**
 * EndpointReady = EndpointResolved AND HealthOK (Architecture Freeze v3.2 Phase 4).
 * @param {Record<string, unknown> | null | undefined} source
 * @param {unknown} healthOk
 */
export function isEndpointReadyForTraffic(source, healthOk) {
  return isEndpointResolved(source) && isHealthOk(healthOk);
}

/**
 * Build consumer Comfy URL. Port 443 → https (Clore http_pub); 80 → http host-only.
 * @param {string} ip
 * @param {number} port
 */
export function formatComfyUrl(ip, port) {
  if (port === 443) return `https://${ip}`;
  if (port === 80) return `http://${ip}`;
  return `http://${ip}:${port}`;
}

export function buildExternalEndpoint(ip, port) {
  const normalizedIp = typeof ip === 'string' && ip.length > 0 ? ip : null;
  const normalizedPort = normalizeExternalPort(port);

  if (
    !normalizedIp ||
    normalizedPort === null ||
    normalizedPort === INTERNAL_CONTAINER_PORT
  ) {
    return { ip: normalizedIp, port: null, comfyUrl: null };
  }

  return {
    ip: normalizedIp,
    port: normalizedPort,
    comfyUrl: formatComfyUrl(normalizedIp, normalizedPort),
  };
}

/**
 * Consumer/read-path endpoint projection.
 * Pending: port=null, comfyUrl=null
 * Resolved + !HealthOK: port=HostPort, comfyUrl=null
 * Resolved + HealthOK: port=HostPort, comfyUrl=http://IP:HostPort
 *
 * @param {Record<string, unknown> | null | undefined} source
 * @param {unknown} [healthOk]
 */
export function buildConsumerEndpoint(source, healthOk = false) {
  if (isEndpointDestroyed(source)) {
    return { ip: readIp(source), port: null, comfyUrl: null };
  }

  if (!isEndpointResolved(source)) {
    return { ip: readIp(source), port: null, comfyUrl: null };
  }

  const ip = readIp(source);
  const port = normalizeExternalPort(source?.port);

  if (!isEndpointReadyForTraffic(source, healthOk)) {
    return { ip, port, comfyUrl: null };
  }

  return {
    ip,
    port,
    comfyUrl: formatComfyUrl(/** @type {string} */ (ip), /** @type {number} */ (port)),
  };
}

export function buildEndpointFromMachine(machine) {
  if (isEndpointDestroyed(machine)) {
    return { ip: readIp(machine), port: null, comfyUrl: null };
  }
  return buildExternalEndpoint(readIp(machine), machine?.port);
}

/**
 * Resolved ip+port only — caller must have passed EndpointReady gate
 * (buildConsumerEndpoint / isEndpointReadyForTraffic).
 */
export function requireComfyUrlFromResolvedEndpoint(ip, port) {
  const { comfyUrl } = buildExternalEndpoint(ip, port);
  if (!comfyUrl) {
    throw new Error('endpoint not ready for traffic');
  }
  return comfyUrl;
}
