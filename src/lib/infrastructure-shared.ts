/** Hằng số & helper dùng chung client/server cho tab Hạ tầng. */

export {
  ESTIMATED_PING_MS_FROM_VN,
  MIN_VRAM_GB,
  PING_BUCKET_LABELS,
  PING_THRESHOLD_MS,
  UPTIME_BUCKET_LABELS,
  UPTIME_THRESHOLD,
  estimatePingMsFromRegion,
  extractPingMs,
  normalizeUptimePercent,
  resolveEffectivePingMs,
  resolveMarketplaceRegionLabel,
  resolvePingBucket,
  resolveUptimeBucket,
} from './infrastructure-metrics.js';

import type { PingBucket, UptimeBucket } from './infrastructure-metrics-types';

export type { PingBucket, UptimeBucket };

/** Region Châu Á — dùng ước lượng ping khi API không trả latency. */
export const ASIA_REGIONS = [
  'Vietnam',
  'Việt Nam',
  'Singapore',
  'Thailand',
  'Malaysia',
  'Indonesia',
  'India',
  'Japan',
  'South Korea',
  'Korea',
  'Taiwan',
  'Hong Kong',
  'Philippines',
  'Cambodia',
  'Laos',
  'Myanmar',
  'Bangladesh',
  'Pakistan',
  'Sri Lanka',
  'Nepal',
  'Mongolia',
  'China',
  'Macau',
  'Brunei',
  'Kazakhstan',
  'Uzbekistan',
  'United Arab Emirates',
  'Saudi Arabia',
  'Israel',
  'Turkey',
] as const;

const ASIA_REGION_SET = new Set(ASIA_REGIONS.map((r) => r.toLowerCase()));

export type GpuStockStatus = 'stable' | 'low' | 'scarce' | 'unavailable';

export type InfrastructureGpuRow = {
  provider: string;
  gpu: string;
  vram: string;
  /** @deprecated Giữ tương thích — không còn dùng để nhóm/lọc. */
  region?: string;
  uptime_bucket: UptimeBucket;
  ping_bucket: PingBucket;
  available: number;
  uptime_7d: number;
  ping_ms: number;
  avg_price_10: number;
  avg_price_10_vnd: number;
  status: GpuStockStatus;
};

export function isAsiaRegion(region: string): boolean {
  return ASIA_REGION_SET.has(region.trim().toLowerCase());
}

export function formatGpuLineLabel(gpu: string, vram: string): string {
  if (gpu === 'RTX 3090' && vram === '24GB') return 'RTX 3090 24GB';
  if (gpu === 'RTX 4090' && vram === '1x 24GB') return 'RTX 4090 1x 24GB';
  if (gpu === 'RTX 4090' && vram === '2x 48GB') return 'RTX 4090 2x 48GB';
  if (gpu === 'RTX 5090' && (vram === '32GB' || vram === '1x 32GB')) return 'RTX 5090 32GB';
  return `${gpu} ${vram}`;
}

export function computeStockStatus(available: number): GpuStockStatus {
  if (available <= 0) return 'unavailable';
  if (available >= 20) return 'stable';
  if (available >= 5) return 'low';
  return 'scarce';
}

export function formatUptime7d(uptime: number): string {
  return `${uptime.toFixed(1)}%`;
}

export function formatPingMs(ping: number): string {
  if (!Number.isFinite(ping) || ping <= 0) return '—';
  return `${Math.round(ping)}ms`;
}

export const INFRA_PROVIDERS = ['Vast.ai', 'Clore.ai'] as const;

export const INFRA_GPU_LINE_FILTERS = [
  { value: 'all', label: 'Tất cả', gpu: null, vram: null },
  { value: 'rtx3090', label: 'RTX 3090 24GB', gpu: 'RTX 3090', vram: '24GB' },
  { value: 'rtx4090_1x', label: 'RTX 4090 1x 24GB', gpu: 'RTX 4090', vram: '1x 24GB' },
  { value: 'rtx5090_1x', label: 'RTX 5090 32GB', gpu: 'RTX 5090', vram: '32GB' },
] as const;

export const INFRA_UPTIME_FILTERS = [
  { value: 'all', label: 'Tất cả', bucket: null as UptimeBucket | null },
  { value: 'gt99', label: '≥ 99%', bucket: 'gt99' as const },
  { value: 'btw_985_99', label: '98.5% – 99%', bucket: 'btw_985_99' as const },
  { value: 'btw_98_985', label: '98% – 98.5%', bucket: 'btw_98_985' as const },
] as const;

export const INFRA_PING_FILTERS = [
  { value: 'all', label: 'Tất cả', bucket: null as PingBucket | null },
  { value: 'lt50', label: '< 50ms', bucket: 'lt50' as const },
  { value: 'btw_50_100', label: '50 – 100ms', bucket: 'btw_50_100' as const },
  { value: 'btw_100_200', label: '100 – 200ms', bucket: 'btw_100_200' as const },
  { value: 'btw_200_250', label: '200 – 250ms', bucket: 'btw_200_250' as const },
] as const;

export const INFRA_STATUS_FILTERS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'stable', label: 'Ổn định' },
  { value: 'low', label: 'Ít hàng' },
  { value: 'scarce', label: 'Khan hiếm' },
] as const;

export type InfrastructureFilters = {
  provider: string;
  gpuLine: string;
  uptime: string;
  ping: string;
  status: string;
};

export const DEFAULT_INFRASTRUCTURE_FILTERS: InfrastructureFilters = {
  provider: 'all',
  gpuLine: 'all',
  uptime: 'all',
  ping: 'all',
  status: 'all',
};

export function filterInfrastructureRows(
  rows: InfrastructureGpuRow[],
  filters: InfrastructureFilters,
): InfrastructureGpuRow[] {
  const gpuLineDef = INFRA_GPU_LINE_FILTERS.find((item) => item.value === filters.gpuLine);
  const uptimeDef = INFRA_UPTIME_FILTERS.find((item) => item.value === filters.uptime);
  const pingDef = INFRA_PING_FILTERS.find((item) => item.value === filters.ping);

  return rows.filter((row) => {
    if (filters.provider !== 'all' && row.provider !== filters.provider) return false;
    if (filters.status !== 'all' && row.status !== filters.status) return false;
    if (uptimeDef?.bucket && row.uptime_bucket !== uptimeDef.bucket) return false;
    if (pingDef?.bucket && row.ping_bucket !== pingDef.bucket) return false;
    if (gpuLineDef?.gpu && (row.gpu !== gpuLineDef.gpu || row.vram !== gpuLineDef.vram)) {
      return false;
    }
    return true;
  });
}
