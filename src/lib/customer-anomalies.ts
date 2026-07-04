export type CustomerAnomalyLevel = 'none' | 'low' | 'medium' | 'high';

export type AnomalySeverity = 'high' | 'medium' | 'low';

export type CustomerAnomalyCode =
  | 'marathon_session'
  | 'heavy_daily'
  | 'burst_sessions'
  | 'hours_critical'
  | 'idle_balance'
  | 'churn_alert'
  | 'expired_still_online'
  | 'multi_machines'
  | 'no_output';

export type CustomerAnomaly = {
  code: CustomerAnomalyCode;
  severity: AnomalySeverity;
  label: string;
  detail: string;
};

export type CustomerAnomalySummaryItem = {
  code: CustomerAnomalyCode;
  label: string;
  severity: AnomalySeverity;
  count: number;
  customers: string[];
};

export type CustomerAnomalySummary = {
  flaggedCount: number;
  criticalCount: number;
  warningCount: number;
  items: CustomerAnomalySummaryItem[];
};

const SEVERITY_RANK: Record<AnomalySeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function daysSince(isoDate: string | null): number {
  if (!isoDate) return 999;
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return 999;
  return (Date.now() - then) / (1000 * 60 * 60 * 24);
}

type AnomalyInput = {
  hoursLeft: number;
  totalHours: number;
  avgDaily: number;
  sessionsPerWeek: number;
  lastAccess: string | null;
  churnRisk: 'low' | 'medium' | 'high';
  isOnline: boolean;
  currentSessionDuration: number;
  machinesRunning: number;
  outputCount: number;
};

/**
 * Phát hiện hành vi bất thường của KH.
 */
export function detectCustomerAnomalies(input: AnomalyInput): CustomerAnomaly[] {
  const anomalies: CustomerAnomaly[] = [];
  const hoursPct = input.totalHours > 0 ? (input.hoursLeft / input.totalHours) * 100 : 0;

  if (input.isOnline && input.hoursLeft <= 0) {
    anomalies.push({
      code: 'expired_still_online',
      severity: 'high',
      label: 'Hết giờ vẫn chạy',
      detail: 'GPU vẫn online dù đã hết giờ gói',
    });
  }

  if (input.machinesRunning >= 3) {
    anomalies.push({
      code: 'multi_machines',
      severity: 'high',
      label: 'Nhiều máy cùng lúc',
      detail: `${input.machinesRunning} máy GPU đang chạy đồng thời (ngưỡng 3)`,
    });
  }

  if (
    input.isOnline &&
    input.currentSessionDuration >= 3 * 3600 &&
    input.outputCount <= 0
  ) {
    const hours = Math.floor(input.currentSessionDuration / 3600);
    anomalies.push({
      code: 'no_output',
      severity: 'high',
      label: 'Không có output',
      detail: `Online ${hours}h+ nhưng chưa có output (outputCount = 0)`,
    });
  }

  if (input.isOnline && input.currentSessionDuration >= 8 * 3600) {
    const hours = Math.floor(input.currentSessionDuration / 3600);
    anomalies.push({
      code: 'marathon_session',
      severity: 'high',
      label: 'Phiên quá dài',
      detail: `Phiên hiện tại ${hours}h+ — vượt ngưỡng 8h`,
    });
  }

  if (input.avgDaily >= 6) {
    anomalies.push({
      code: 'heavy_daily',
      severity: 'high',
      label: 'Dùng quá nhiều',
      detail: `Trung bình ${input.avgDaily.toFixed(1)}h/ngày (ngưỡng 6h)`,
    });
  }

  if (input.sessionsPerWeek >= 8) {
    anomalies.push({
      code: 'burst_sessions',
      severity: 'medium',
      label: 'Nhiều phiên/tuần',
      detail: `${input.sessionsPerWeek} phiên/tuần (ngưỡng 8)`,
    });
  }

  if (
    input.hoursLeft > 0 &&
    input.totalHours > 0 &&
    hoursPct < 5 &&
    input.sessionsPerWeek >= 3
  ) {
    anomalies.push({
      code: 'hours_critical',
      severity: 'low',
      label: 'Sắp hết giờ nhanh',
      detail: `Còn ${input.hoursLeft}h (${hoursPct.toFixed(1)}% gói) — thông tin theo dõi`,
    });
  }

  if (input.churnRisk === 'high') {
    anomalies.push({
      code: 'churn_alert',
      severity: 'medium',
      label: 'Rủi ro rời bỏ',
      detail: 'Churn risk cao — cần theo dõi',
    });
  }

  if (
    input.hoursLeft >= 20 &&
    input.sessionsPerWeek === 0 &&
    daysSince(input.lastAccess) > 14
  ) {
    anomalies.push({
      code: 'idle_balance',
      severity: 'low',
      label: 'Có giờ không dùng',
      detail: `Còn ${input.hoursLeft}h nhưng >14 ngày không hoạt động`,
    });
  }

  return anomalies.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
}

export function getAnomalyLevel(anomalies: CustomerAnomaly[]): CustomerAnomalyLevel {
  if (!anomalies.length) return 'none';
  if (anomalies.some((a) => a.severity === 'high')) return 'high';
  if (anomalies.some((a) => a.severity === 'medium')) return 'medium';
  return 'low';
}

export function buildAnomalySummary(
  rows: { name: string; anomalies: CustomerAnomaly[]; anomalyLevel: CustomerAnomalyLevel }[],
): CustomerAnomalySummary {
  const byCode = new Map<CustomerAnomalyCode, CustomerAnomalySummaryItem>();

  for (const row of rows) {
    for (const anomaly of row.anomalies) {
      const existing = byCode.get(anomaly.code);
      if (existing) {
        existing.count += 1;
        if (!existing.customers.includes(row.name)) {
          existing.customers.push(row.name);
        }
      } else {
        byCode.set(anomaly.code, {
          code: anomaly.code,
          label: anomaly.label,
          severity: anomaly.severity,
          count: 1,
          customers: [row.name],
        });
      }
    }
  }

  const items = Array.from(byCode.values()).sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );

  const flaggedCount = rows.filter((r) => r.anomalies.length > 0).length;
  const criticalCount = rows.filter((r) => r.anomalyLevel === 'high').length;
  const warningCount = rows.filter(
    (r) => r.anomalyLevel === 'medium' || r.anomalyLevel === 'low',
  ).length;

  return { flaggedCount, criticalCount, warningCount, items };
}
