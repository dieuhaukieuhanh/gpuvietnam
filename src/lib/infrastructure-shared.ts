/** Hằng số & helper dùng chung client/server cho tab Hạ tầng. */

export const UPTIME_THRESHOLD = 99.5;

/** Region Châu Á được phép hiển thị (EN + tên địa phương phổ biến). */
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
] as const;

const ASIA_REGION_SET = new Set(ASIA_REGIONS.map((r) => r.toLowerCase()));

export type GpuStockStatus = 'stable' | 'low' | 'scarce' | 'unavailable';

export type InfrastructureGpuRow = {
  provider: string;
  gpu: string;
  vram: string;
  region: string;
  available: number;
  uptime_7d: number;
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

export const INFRA_PROVIDERS = ['Vast.ai', 'RunPod', 'TensorDock'] as const;

export const INFRA_GPU_LINE_FILTERS = [
  { value: 'all', label: 'Tất cả', gpu: null, vram: null },
  { value: 'rtx3090', label: 'RTX 3090 24GB', gpu: 'RTX 3090', vram: '24GB' },
  { value: 'rtx4090_1x', label: 'RTX 4090 1x 24GB', gpu: 'RTX 4090', vram: '1x 24GB' },
  { value: 'rtx4090_2x', label: 'RTX 4090 2x 48GB', gpu: 'RTX 4090', vram: '2x 48GB' },
] as const;

export const INFRA_REGION_FILTERS = [
  'Singapore',
  'Japan',
  'India',
  'South Korea',
  'Taiwan',
  'Vietnam',
  'Thailand',
  'Malaysia',
  'Indonesia',
  'Hong Kong',
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
  region: string;
  status: string;
};

export const DEFAULT_INFRASTRUCTURE_FILTERS: InfrastructureFilters = {
  provider: 'all',
  gpuLine: 'all',
  region: 'all',
  status: 'all',
};

export function filterInfrastructureRows(
  rows: InfrastructureGpuRow[],
  filters: InfrastructureFilters,
): InfrastructureGpuRow[] {
  const gpuLineDef = INFRA_GPU_LINE_FILTERS.find((item) => item.value === filters.gpuLine);

  return rows.filter((row) => {
    if (filters.provider !== 'all' && row.provider !== filters.provider) return false;
    if (filters.region !== 'all' && row.region !== filters.region) return false;
    if (filters.status !== 'all' && row.status !== filters.status) return false;
    if (gpuLineDef?.gpu && (row.gpu !== gpuLineDef.gpu || row.vram !== gpuLineDef.vram)) {
      return false;
    }
    return true;
  });
}
