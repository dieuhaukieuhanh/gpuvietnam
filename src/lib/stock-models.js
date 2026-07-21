import { resolvePublicApiBaseUrl } from './machine-backup-token.js';

/**
 * Stock ComfyUI models on R2 (Solution A).
 * Keys: stock/models/{checkpoints|loras|upscale_models}/...
 * Containers get GPUVIETNAM_MODELS_BASE_URL only (no R2 secrets).
 */

export const STOCK_MODELS_R2_PREFIX = 'stock/models';

/** @type {ReadonlyArray<{ r2Relative: string; localSubdir: string; fileName: string; required: boolean }>} */
export const STOCK_MODEL_MANIFEST = Object.freeze([
  {
    r2Relative: 'checkpoints/sd_xl_base_1.0.safetensors',
    localSubdir: 'checkpoints',
    fileName: 'sd_xl_base_1.0.safetensors',
    required: true,
  },
  {
    r2Relative: 'checkpoints/RealVisXL_V6.0_B1.safetensors',
    localSubdir: 'checkpoints',
    fileName: 'RealVisXL_V6.0_B1.safetensors',
    required: true,
  },
  {
    r2Relative: 'upscale_models/RealESRGAN_x4plus.pth',
    localSubdir: 'upscale_models',
    fileName: 'RealESRGAN_x4plus.pth',
    required: true,
  },
]);

const ALLOWED_RELATIVE = new Set(STOCK_MODEL_MANIFEST.map((m) => m.r2Relative));

/**
 * @param {string} relativeKey
 * @returns {{ ok: true, key: string } | { ok: false, error: string }}
 */
export function sanitizeStockModelRelativeKey(relativeKey) {
  let key = String(relativeKey ?? '').trim().replace(/\\/g, '/');
  while (key.startsWith('/')) key = key.slice(1);
  if (!key || key.includes('..') || key.split('/').some((p) => p === '' || p === '..')) {
    return { ok: false, error: 'Key không hợp lệ.' };
  }
  if (!ALLOWED_RELATIVE.has(key)) {
    return { ok: false, error: 'Model không nằm trong stock allowlist.' };
  }
  return { ok: true, key };
}

/**
 * Base URL containers curl for stock files.
 * Prefer explicit public CDN; else app redirect API (presigned GET).
 * @returns {string | null}
 */
export function resolveStockModelsBaseUrl() {
  const direct = String(process.env.GPUVIETNAM_MODELS_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (direct) return direct;

  const pub = String(process.env.R2_PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (pub) return pub + '/' + STOCK_MODELS_R2_PREFIX;

  const api = resolvePublicApiBaseUrl();
  if (api) return api + '/api/storage/stock/models';

  return null;
}

/**
 * @param {string} r2Relative e.g. checkpoints/sd_xl_base_1.0.safetensors
 */
export function buildStockModelR2Key(r2Relative) {
  const rel = String(r2Relative ?? '').replace(/^\/+/, '');
  return STOCK_MODELS_R2_PREFIX + '/' + rel;
}
