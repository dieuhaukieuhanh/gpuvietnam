import {
  formatBillingLabel as formatBillingLabelFromPricing,
  formatGpuConfigShort,
} from '@/lib/gpu-pricing';

export function formatBillingLabel(billing) {
  return formatBillingLabelFromPricing(billing);
}

export function formatGpuConfig(plan, gpuLabel) {
  if (gpuLabel) return gpuLabel;
  return formatGpuConfigShort(plan);
}

export function formatDurationSeconds(totalSeconds, { running = false } = {}) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h > 0) parts.push(`${h} giờ`);
  if (m > 0) parts.push(`${m} phút`);
  if (s > 0 || parts.length === 0) parts.push(`${s.toString().padStart(2, '0')} giây`);
  const base = parts.join(' ');
  return running ? `${base} (đang đếm...)` : base;
}

export function formatSessionDate(iso) {
  return new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatSessionTime(iso) {
  return new Date(iso).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatVramLabel(session) {
  if (session.status === 'running') {
    const pct = session.vram_current_pct ?? session.vram_avg_pct;
    if (pct == null) return '—';
    return `${Math.round(Number(pct))}% (hiện tại)`;
  }
  if (session.vram_avg_pct == null) return '—';
  return `${Math.round(Number(session.vram_avg_pct))}%`;
}

export function getSessionStatusLabel(status) {
  return getScbSessionStatusLabel(status);
}

/** SCB session status labels — display only (M12). */
export function getScbSessionStatusLabel(status) {
  if (status === 'pending') return '⏳ Chờ xác minh';
  if (status === 'running') return '🔄 Đang chạy';
  if (status === 'closing') return '⏳ Đang đóng';
  if (status === 'closed') return '✅ Đã đóng';
  if (status === 'interrupted') return '⚠️ Bị ngắt';
  if (status === 'completed') return '✅ Hoàn thành';
  return String(status ?? '—');
}

/** Settlement status badge text — display only (M12). */
export function getSettlementStatusLabel(settlementStatus) {
  if (!settlementStatus) return null;
  if (settlementStatus === 'settled') return '✅ Đã quyết toán';
  if (settlementStatus === 'skipped') return '⏭️ Bỏ qua quyết toán';
  if (settlementStatus === 'failed') return '❌ Quyết toán thất bại';
  if (settlementStatus === 'in_progress') return '⏳ Đang quyết toán';
  if (settlementStatus === 'awaiting_verify') return '⏳ Chờ xác minh destroy';
  if (settlementStatus === 'not_applicable') return '—';
  return String(settlementStatus);
}

/**
 * Billable seconds for history display — server projection from row timestamps only.
 * @param {Record<string, unknown>} row
 * @param {number} durationSeconds
 */
export function projectBillableSeconds(row, durationSeconds) {
  const status = String(row.status ?? '');
  if (status === 'running' || status === 'pending' || status === 'closing') {
    return null;
  }
  if (status === 'interrupted') {
    return 0;
  }
  if (!row.started_at || !row.ended_at) {
    return null;
  }
  return Math.max(0, Math.floor(Number(durationSeconds) || 0));
}

export function mapSessionRow(row, { sessionNumber, isLive = false } = {}) {
  const status = row.status ?? 'completed';
  const startedAt = row.started_at;
  const endedAt = row.ended_at ?? null;
  let durationSeconds = Number(row.duration_seconds);
  if (!durationSeconds && startedAt && endedAt) {
    durationSeconds = Math.floor(
      (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    );
  }
  if (status === 'running' && startedAt && !endedAt) {
    durationSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  }

  const billableSeconds = projectBillableSeconds(row, durationSeconds);
  const settlementStatus = row.settlement_status ?? null;

  return {
    id: row.id,
    sessionNumber,
    template: row.template,
    plan: row.plan,
    billing: row.billing,
    billingLabel: formatBillingLabel(row.billing),
    gpuConfig: formatGpuConfig(row.plan, row.gpu_config),
    status,
    statusLabel: getScbSessionStatusLabel(status),
    settlementStatus,
    settlementStatusLabel: getSettlementStatusLabel(settlementStatus),
    settlementAt: row.settlement_at ?? null,
    settlementBreakdown: row.settlement_breakdown ?? null,
    verifiedRunningAt: row.verified_running_at ?? null,
    verifiedDestroyedAt: row.verified_destroyed_at ?? null,
    destroyReason: row.destroy_reason ?? null,
    billableSeconds,
    billableLabel:
      billableSeconds != null ? formatDurationSeconds(billableSeconds, { running: false }) : '—',
    vramLabel: formatVramLabel(row),
    startedAt,
    endedAt,
    durationSeconds,
    durationLabel: formatDurationSeconds(durationSeconds, { running: status === 'running' }),
    outputSummary:
      Number(row.output_count ?? 0) > 0
        ? `${row.output_count} file output`
        : row.output_summary ?? '—',
    isLive,
  };
}
