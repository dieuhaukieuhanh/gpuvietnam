import { resolveClorePublicEndpoints } from './gpu/providers/clore/clore-mapper.js';
import { CloreClient } from './gpu/providers/clore/clore-client.js';
import { formatComfyUrl } from './endpoint-utils.js';

export const BACKUP_FLUSH_PATH = '/gpuvietnam/backup/flush';

/**
 * @param {Record<string, unknown>} machine
 * @returns {string | null}
 */
export function resolveFlushSecretFromMachine(machine) {
  const secret = machine?.backup_flush_secret;
  if (secret != null && String(secret).trim()) return String(secret).trim();
  return null;
}

/**
 * Build Comfy base URL for flush from machine row fields.
 * @param {Record<string, unknown>} machine
 */
export function resolveFlushBaseUrlFromMachine(machine) {
  const ip = machine?.ip_address ?? machine?.ip ?? null;
  const portRaw = machine?.port;
  const port = portRaw != null ? Number(portRaw) : null;
  if (ip && port != null && Number.isFinite(port) && port > 0) {
    return formatComfyUrl(String(ip), port);
  }
  if (ip && (port == null || port === 443)) {
    // Clore http_pub style hostname stored in ip_address
    const host = String(ip).replace(/^https?:\/\//i, '').split('/')[0];
    if (host.includes('.')) return `https://${host}`;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} cloreOrder
 */
export function resolveFlushBaseUrlFromCloreOrder(cloreOrder) {
  const endpoints = resolveClorePublicEndpoints(cloreOrder || {});
  if (endpoints.endpointUrl) {
    return String(endpoints.endpointUrl).replace(/\/+$/, '');
  }
  return null;
}

/**
 * @param {string} baseUrl
 */
export function buildBackupFlushUrl(baseUrl) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  if (!base) throw new Error('Missing Comfy base URL for backup flush');
  return `${base}${BACKUP_FLUSH_PATH}`;
}

/**
 * POST flush to container (L1-equivalent upload via periodic-backup.sh --once).
 * @param {{ baseUrl: string; flushSecret: string; timeoutMs?: number; fetchImpl?: typeof fetch }} input
 */
export async function requestContainerBackupFlush(input) {
  const url = buildBackupFlushUrl(input.baseUrl);
  const timeoutMs = Math.min(
    900_000,
    Math.max(30_000, Math.floor(Number(input.timeoutMs ?? 600_000) || 600_000)),
  );
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available for backup flush');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.flushSecret}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    /** @type {Record<string, unknown>} */
    let body = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    return {
      ok: res.ok && body?.ok !== false,
      status: res.status,
      body,
      url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve Clore Comfy base URL for an instance (fresh order read).
 * @param {string} instanceId
 */
export async function resolveCloreFlushBaseUrl(instanceId) {
  const client = new CloreClient();
  const order = await client.getOrder(instanceId);
  return resolveFlushBaseUrlFromCloreOrder(order);
}