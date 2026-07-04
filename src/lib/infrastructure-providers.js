/**
 * GPU sẵn sàng từ Vast.ai, RunPod, TensorDock.
 * Chỉ Region Châu Á · Uptime 7D ≥ 99.5%.
 * Mock cho tới khi có API key: VAST_AI_KEY, RUNPOD_API_KEY, TENSORDOCK_KEY
 */

import {
  UPTIME_THRESHOLD,
  computeStockStatus,
  formatGpuLineLabel,
  isAsiaRegion,
} from '@/lib/infrastructure-shared';
import { usdHourlyToVnd } from '@/lib/currency';

export { UPTIME_THRESHOLD, formatGpuLineLabel, computeStockStatus, isAsiaRegion };

/** @typedef {'stable' | 'low' | 'scarce' | 'unavailable'} GpuStockStatus */

/**
 * @typedef {Object} InfrastructureGpuRow
 * @property {string} provider
 * @property {string} gpu
 * @property {string} vram
 * @property {string} region
 * @property {number} available
 * @property {number} uptime_7d
 * @property {number} avg_price_10
 * @property {number} avg_price_10_vnd
 * @property {GpuStockStatus} status
 */

/**
 * @typedef {Object} RawGpuOffer
 * @property {string} provider
 * @property {string} gpu
 * @property {string} vram
 * @property {string} region
 * @property {number} price_per_hour
 * @property {number} uptime_7d
 */

export const ALLOWED_GPU_LINES = [
  { gpu: 'RTX 3090', vram: '24GB' },
  { gpu: 'RTX 4090', vram: '1x 24GB' },
  { gpu: 'RTX 4090', vram: '2x 48GB' },
];

const PROVIDER_ORDER = ['Vast.ai', 'RunPod', 'TensorDock'];

/**
 * Lấy trung bình giá của tối đa 10 GPU rẻ nhất (sắp xếp tăng dần).
 * @param {number[]} prices
 * @returns {number | null}
 */
export function computeAvgPrice10(prices) {
  const sorted = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const slice = sorted.slice(0, 10);
  return slice.reduce((sum, price) => sum + price, 0) / slice.length;
}

/**
 * Gom offer thô — chỉ GPU được phép, Region Châu Á, uptime 7D ≥ ngưỡng.
 * @param {RawGpuOffer[]} offers
 * @returns {InfrastructureGpuRow[]}
 */
export function aggregateInfrastructureRows(offers) {
  /** @type {Map<string, { provider: string, gpu: string, vram: string, region: string, prices: number[], uptimes: number[] }>} */
  const groups = new Map();

  for (const offer of offers) {
    if (!isAsiaRegion(offer.region)) continue;

    const allowed = ALLOWED_GPU_LINES.some((line) => line.gpu === offer.gpu && line.vram === offer.vram);
    if (!allowed) continue;
    if (offer.uptime_7d < UPTIME_THRESHOLD) continue;

    const key = `${offer.provider}::${offer.gpu}::${offer.vram}::${offer.region}`;
    if (!groups.has(key)) {
      groups.set(key, {
        provider: offer.provider,
        gpu: offer.gpu,
        vram: offer.vram,
        region: offer.region,
        prices: [],
        uptimes: [],
      });
    }
    const group = groups.get(key);
    group.prices.push(offer.price_per_hour);
    group.uptimes.push(offer.uptime_7d);
  }

  /** @type {InfrastructureGpuRow[]} */
  const rows = [];

  for (const group of groups.values()) {
    const available = group.prices.length;
    const avgPrice = computeAvgPrice10(group.prices);
    const avgUptime7d = group.uptimes.reduce((sum, value) => sum + value, 0) / group.uptimes.length;
    rows.push({
      provider: group.provider,
      gpu: group.gpu,
      vram: group.vram,
      region: group.region,
      available,
      uptime_7d: avgUptime7d,
      avg_price_10: avgPrice ?? 0,
      status: computeStockStatus(available),
    });
  }

  return sortInfrastructureRows(rows);
}

/**
 * @param {InfrastructureGpuRow} row
 */
function attachVndPrice(row) {
  const avg_price_10_vnd =
    row.avg_price_10_vnd ??
    (row.avg_price_10 > 0 ? usdHourlyToVnd(row.avg_price_10) : 0);
  return { ...row, avg_price_10_vnd };
}

/**
 * @param {InfrastructureGpuRow[]} rows
 */
export function enrichInfrastructureRows(rows) {
  return rows
    .filter((row) => isAsiaRegion(row.region))
    .map((row) =>
      attachVndPrice({
        ...row,
        status: row.available <= 0 ? 'unavailable' : computeStockStatus(row.available),
      }),
    );
}

/**
 * @param {InfrastructureGpuRow[]} rows
 */
export function sortInfrastructureRows(rows) {
  const gpuOrder = (gpu, vram) => {
    if (gpu === 'RTX 3090') return 0;
    if (vram === '1x 24GB') return 1;
    if (vram === '2x 48GB') return 2;
    return 99;
  };

  return [...rows].sort((a, b) => {
    const providerDiff =
      PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider);
    if (providerDiff !== 0) return providerDiff;
    const gpuDiff = gpuOrder(a.gpu, a.vram) - gpuOrder(b.gpu, b.vram);
    if (gpuDiff !== 0) return gpuDiff;
    return a.region.localeCompare(b.region);
  });
}

export function getMockInfrastructureData() {
  return enrichInfrastructureRows(
    sortInfrastructureRows([
      { provider: 'Vast.ai', gpu: 'RTX 3090', vram: '24GB', region: 'Singapore', available: 45, uptime_7d: 99.8, avg_price_10: 0.32, avg_price_10_vnd: 8640 },
      { provider: 'Vast.ai', gpu: 'RTX 3090', vram: '24GB', region: 'India', available: 22, uptime_7d: 99.6, avg_price_10: 0.28, avg_price_10_vnd: 7560 },
      { provider: 'Vast.ai', gpu: 'RTX 4090', vram: '1x 24GB', region: 'Japan', available: 18, uptime_7d: 99.7, avg_price_10: 0.44, avg_price_10_vnd: 11880 },
      { provider: 'Vast.ai', gpu: 'RTX 4090', vram: '1x 24GB', region: 'Singapore', available: 7, uptime_7d: 99.5, avg_price_10: 0.46, avg_price_10_vnd: 12420 },
      { provider: 'Vast.ai', gpu: 'RTX 4090', vram: '2x 48GB', region: 'South Korea', available: 3, uptime_7d: 99.5, avg_price_10: 0.89, avg_price_10_vnd: 24030 },
      { provider: 'RunPod', gpu: 'RTX 3090', vram: '24GB', region: 'Singapore', available: 30, uptime_7d: 99.9, avg_price_10: 0.38, avg_price_10_vnd: 10260 },
      { provider: 'RunPod', gpu: 'RTX 4090', vram: '1x 24GB', region: 'Thailand', available: 8, uptime_7d: 99.6, avg_price_10: 0.49, avg_price_10_vnd: 13230 },
      { provider: 'RunPod', gpu: 'RTX 4090', vram: '2x 48GB', region: 'Vietnam', available: 0, uptime_7d: 0, avg_price_10: 0, avg_price_10_vnd: 0 },
      { provider: 'TensorDock', gpu: 'RTX 3090', vram: '24GB', region: 'Taiwan', available: 35, uptime_7d: 99.7, avg_price_10: 0.3, avg_price_10_vnd: 8100 },
      { provider: 'TensorDock', gpu: 'RTX 4090', vram: '1x 24GB', region: 'Malaysia', available: 5, uptime_7d: 99.5, avg_price_10: 0.42, avg_price_10_vnd: 11340 },
      { provider: 'TensorDock', gpu: 'RTX 4090', vram: '2x 48GB', region: 'India', available: 1, uptime_7d: 99.8, avg_price_10: 0.92, avg_price_10_vnd: 24840 },
    ]),
  );
}

/**
 * @returns {Promise<RawGpuOffer[] | null>}
 */
async function fetchVastAiOffers() {
  const apiKey = process.env.VAST_AI_KEY;
  if (!apiKey) return null;
  // TODO: Replace with real API call — lọc geolocation/region Châu Á trên Vast.ai
  return null;
}

/**
 * @returns {Promise<RawGpuOffer[] | null>}
 */
async function fetchRunPodOffers() {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) return null;
  // TODO: Replace with real API call — lọc data center Châu Á trên RunPod
  return null;
}

/**
 * @returns {Promise<RawGpuOffer[] | null>}
 */
async function fetchTensorDockOffers() {
  const apiKey = process.env.TENSORDOCK_KEY;
  if (!apiKey) return null;
  // TODO: Replace with real API call — lọc region Châu Á trên TensorDock
  return null;
}

/**
 * @returns {Promise<InfrastructureGpuRow[]>}
 */
export async function fetchInfrastructureData() {
  const realOfferLists = await Promise.all([
    fetchVastAiOffers(),
    fetchRunPodOffers(),
    fetchTensorDockOffers(),
  ]);

  const mergedOffers = realOfferLists.filter(Boolean).flat();
  if (mergedOffers.length > 0) {
    return enrichInfrastructureRows(aggregateInfrastructureRows(mergedOffers));
  }

  return getMockInfrastructureData();
}
