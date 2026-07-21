import { isComfyProxyEnabled } from './comfy-proxy-config.js';

/**
 * Strip upstream host details from client-facing payloads when proxy is on.
 * Keeps workReady so the UI knows Comfy can be opened via brand domain.
 *
 * @param {Record<string, unknown> | null | undefined} payload
 * @returns {Record<string, unknown> | null | undefined}
 */
export function redactComfyUpstreamForClient(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!isComfyProxyEnabled()) return payload;

  const comfyUrl = typeof payload.comfyUrl === 'string' ? payload.comfyUrl : null;
  const workReady = Boolean(comfyUrl) || payload.workReady === true;

  return {
    ...payload,
    comfyUrl: null,
    ip: null,
    port: null,
    workReady,
  };
}
