import { resolveGpuImage } from './gpu/gpu-config.js';

/**
 * Resolve ComfyUI image tag for machines.image projection (v3/v4 audit).
 * @param {{ metadata?: Record<string, unknown> | null } | Record<string, unknown> | null | undefined} instance
 * @param {{ gpuLine?: string; image?: string | null }} [context]
 * @returns {string | null}
 */
export function resolveMachineImage(instance, context = {}) {
  const fromContext = context.image != null ? String(context.image).trim() : '';
  if (fromContext) return fromContext;

  const meta =
    instance && typeof instance === 'object' && instance.metadata && typeof instance.metadata === 'object'
      ? /** @type {Record<string, unknown>} */ (instance.metadata)
      : null;
  if (meta) {
    const metaImage = meta.image != null ? String(meta.image).trim() : '';
    if (metaImage) return metaImage;
    const vast =
      meta.vast && typeof meta.vast === 'object'
        ? /** @type {Record<string, unknown>} */ (meta.vast)
        : null;
    if (vast?.image != null && String(vast.image).trim()) return String(vast.image).trim();
    const clore =
      meta.clore && typeof meta.clore === 'object'
        ? /** @type {Record<string, unknown>} */ (meta.clore)
        : null;
    if (clore?.image != null && String(clore.image).trim()) return String(clore.image).trim();
  }

  const gpuLine = context.gpuLine != null ? String(context.gpuLine).trim() : '';
  if (gpuLine) return resolveGpuImage(gpuLine);
  return null;
}
