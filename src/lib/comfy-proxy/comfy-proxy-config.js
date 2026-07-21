/**
 * ComfyUI brand-domain reverse proxy (Level C).
 * Default OFF - set COMFY_PROXY_ENABLED=1 after Worker + DNS are live.
 */

export const COMFY_ACCESS_TOKEN_PREFIX = 'gvc.';
export const COMFY_ACCESS_COOKIE = 'gvn_comfy';
export const DEFAULT_COMFY_ACCESS_TTL_SECONDS = 60 * 60;
export const COMFY_PROXY_RESOLVE_PATH = '/api/internal/comfy-proxy-resolve';

/** @returns {boolean} */
export function isComfyProxyEnabled() {
  const raw = String(process.env.COMFY_PROXY_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Public Worker / brand base for opening ComfyUI (no trailing slash).
 * @returns {string | null}
 */
export function resolveComfyProxyBaseUrl() {
  const raw =
    process.env.COMFY_PROXY_BASE_URL ||
    process.env.NEXT_PUBLIC_COMFY_PROXY_BASE_URL ||
    '';
  const base = String(raw).trim().replace(/\/$/, '');
  return base || null;
}

/**
 * Shared secret for Worker to origin resolve calls.
 * @returns {string | null}
 */
export function resolveComfyProxySharedSecret() {
  const secret = String(process.env.COMFY_PROXY_SECRET ?? '').trim();
  return secret || null;
}

/**
 * @param {string} token
 * @returns {string | null}
 */
export function buildComfyWorkEnterUrl(token) {
  const base = resolveComfyProxyBaseUrl();
  if (!base || !token) return null;
  return base + '/enter/' + encodeURIComponent(token);
}