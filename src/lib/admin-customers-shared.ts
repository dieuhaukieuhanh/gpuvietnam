export type ChurnRiskLevel = 'low' | 'medium' | 'high';

export type CustomerStatus = 'active' | 'hasHours' | 'expired';

export type RealtimeStatus = 'online' | 'hasPlan' | 'expired';

export type AdminCustomerRow = {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  phone: string | null;
  plan: string;
  hoursLeft: number;
  totalHours: number;
  /** Số ngày còn lại tới hết hạn — max trong các gói thanh toán cùng tier */
  daysLeft: number | null;
  lastAccess: string | null;
  workflow: string;
  model: string;
  journey: string;
  revenue: number;
  avgDaily: number;
  churnRisk: ChurnRiskLevel;
  churnScore: number;
  sessionsPerWeek: number;
  history: string[];
  region: string;
  isUsing: boolean;
  status: CustomerStatus;
  /** GPU đang chạy (machines.status = running) */
  isOnline: boolean;
  realtimeStatus: RealtimeStatus;
  /** Thời lượng phiên hiện tại (giây), tính tại thời điểm API */
  currentSessionDuration: number;
  /** ISO — dùng để đếm live trên client */
  sessionStartedAt: string | null;
  /** Template đang dùng khi online */
  currentTemplate: string | null;
  /** Provider máy đang chạy: clore | vast (từ machines.provider) */
  currentProvider: string | null;
  /** Admin audit — ComfyUI image tag (v3/v4). Never shown to customers. */
  runtimeImage: string | null;
  /** Admin audit — gpu_line (rtx3090 / rtx4090_1x / rtx5090_1x). */
  gpuLine: string | null;
  /** Admin audit — HTTP gate passed but SSH/ops degraded. */
  opsDegraded: boolean;
  /** Admin audit — soft SSH probe result (null = unknown). */
  sshOk: boolean | null;
  /** Số máy GPU đang chạy */
  machinesRunning: number;
  /** Output phiên hiện tại */
  outputCount: number;
  /** Cảnh báo hành vi bất thường */
  anomalies: import('@/lib/customer-anomalies').CustomerAnomaly[];
  anomalyLevel: import('@/lib/customer-anomalies').CustomerAnomalyLevel;
  /** Admin override: null | force_on | force_off */
  autoBackupOverride: 'force_on' | 'force_off' | null;
  /** Effective auto-backup after policy resolve */
  autoBackupEnabled: boolean;
  /** Resolve source: force_on | force_off | global_starter | plan_default */
  autoBackupSource: string;
};

export type { CustomerAnomaly, CustomerAnomalyLevel, CustomerAnomalySummary } from '@/lib/customer-anomalies';

export type CustomerStats = {
  totalCustomers: number;
  newThisMonth: number;
  activeUsing: number;
  withHours: number;
  avgRevenuePerCustomer: number;
  totalRevenue: number;
  retentionRate: number;
  retentionDelta: number;
  peakHours: { morning: number; afternoon: number; evening: number };
  peakHourNote: string;
  gpuRegions: { label: string; percent: number; badge: string }[];
  templateNote: string;
};

export type CustomerFilters = {
  status: string;
  plan: string;
  template: string;
  region: string;
  search: string;
  alert: string;
};

/** Map machines.provider → nhãn Admin (Clore / Vast). */
export function formatMachineProviderLabel(
  provider: string | null | undefined,
): string | null {
  const raw = String(provider ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw === 'clore' || raw.startsWith('clore')) return 'Clore';
  if (raw === 'vast' || raw.startsWith('vast')) return 'Vast';
  return raw;
}

export const DEFAULT_CUSTOMER_FILTERS: CustomerFilters = {
  status: 'all',
  plan: 'all',
  template: 'all',
  region: 'all',
  search: '',
  alert: 'all',
};

export type CustomerSortField =
  | 'name'
  | 'plan'
  | 'hoursLeft'
  | 'lastAccess'
  | 'workflow'
  | 'model'
  | 'journey'
  | 'revenue'
  | 'avgDaily'
  | 'churnRisk'
  | 'sessionsPerWeek'
  | 'anomalyLevel';

export const CUSTOMER_SORT_COLUMNS: { key: CustomerSortField; label: string }[] = [
  { key: 'name', label: 'KH' },
  { key: 'plan', label: 'Gói' },
  { key: 'hoursLeft', label: 'Giờ còn' },
  { key: 'lastAccess', label: 'Lần cuối' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'model', label: 'Model' },
  { key: 'journey', label: 'Hành trình' },
  { key: 'revenue', label: 'Doanh thu' },
  { key: 'avgDaily', label: 'Giờ TB/ngày' },
  { key: 'churnRisk', label: 'Churn Risk' },
  { key: 'sessionsPerWeek', label: 'Phiên/tuần' },
  { key: 'anomalyLevel', label: 'Cảnh báo' },
];

/** Định dạng thời lượng phiên: 2h15p */
export function formatSessionDurationShort(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? `${m}p` : ''}`;
  if (m > 0) return `${m}p`;
  return `${seconds}s`;
}
