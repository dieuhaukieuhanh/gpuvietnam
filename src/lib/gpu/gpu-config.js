/** @typedef {import('./domain/gpu-instance').GPULine} GPULine */

export const PLAN_TO_GPU = {
  starter: 'rtx3090',
  pro: 'rtx4090_1x',
  studio: 'rtx4090_2x',
};

export const DEFAULT_GPU_IMAGE =
  process.env.DEFAULT_GPU_IMAGE ??
  process.env.GPUVIETNAM_COMFYUI_IMAGE ??
  'dieuhaukieuhanh/gpuvietnam-comfyui:v1';

export const DEFAULT_DISK_SIZE = Number(process.env.DEFAULT_DISK_SIZE ?? 32);

export const DEFAULT_GPU_PORT = Number(process.env.DEFAULT_GPU_PORT ?? process.env.COMFYUI_PORT ?? 8080);

const DEFAULT_REGIONS = ['Taiwan', 'Japan', 'Singapore'];

export function getDefaultGpuRegions() {
  const raw = process.env.GPU_REGIONS;
  if (!raw) return DEFAULT_REGIONS;
  const regions = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return regions.length > 0 ? regions : DEFAULT_REGIONS;
}

/**
 * @param {string | null | undefined} planKeyOrName
 * @returns {GPULine}
 */
export function resolveGpuLineFromPlan(planKeyOrName) {
  const normalized = String(planKeyOrName ?? '')
    .trim()
    .toLowerCase();
  if (normalized in PLAN_TO_GPU) {
    return /** @type {GPULine} */ (PLAN_TO_GPU[normalized]);
  }
  if (/starter/i.test(normalized)) return 'rtx3090';
  if (/studio/i.test(normalized)) return 'rtx4090_2x';
  if (/pro/i.test(normalized)) return 'rtx4090_1x';
  return 'rtx4090_1x';
}

/** @type {Record<string, number>} */
export const GPU_REGION_SCORES = {
  taiwan: 90,
  thailand: 85,
  singapore: 80,
  'hong kong': 80,
  hongkong: 80,
  japan: 75,
  'south korea': 70,
  korea: 70,
  indonesia: 65,
  malaysia: 65,
  india: 65,
};

/** Hard filters applied at every fallback level (quality never relaxed). */
export const GPU_STRICT_FILTERS = {
  minReliability: 0.995,
  minDiskGb: 20,
  minMaxDurationDays: 3,
  minInetDownMbps: 100,
  minOpenPorts: 0,
  minVramGb: 22,
};

export const GPU_SCORE_WEIGHTS = {
  price: 0.6,
  region: 0.15,
  network: 0.1,
  uptime: 0.1,
  dlperf: 0.05,
};

export const MAX_PRICE_PREMIUM = 1.2;
export const MAX_OFFERS_PER_REGION = 3;

/** Geography-only fallback: preferred Asia → full Asia → global. */
export const GPU_FALLBACK_LEVELS = [
  { label: 'asia_preferred', asiaMode: 'preferred' },
  { label: 'asia_full', asiaMode: 'full' },
  { label: 'global', asiaMode: 'global' },
];
