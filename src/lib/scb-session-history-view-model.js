/**
 * M12 — Session / Billing History API → View Model (display mapping only).
 */

function formatSecondsLabel(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h > 0) parts.push(`${h} giờ`);
  if (m > 0) parts.push(`${m} phút`);
  if (parts.length === 0) parts.push(`${s} giây`);
  return parts.join(' ');
}

function asStr(value, fallback = '—') {
  return value != null && value !== '' ? String(value) : fallback;
}

/**
 * @param {Record<string, unknown> | null | undefined} session
 */
export function mapSessionApiToHistoryView(session) {
  if (!session) {
    return null;
  }

  const settlementBreakdown = session.settlementBreakdown ?? null;

  return {
    id: String(session.id ?? ''),
    sessionNumber: Number(session.sessionNumber ?? 0),
    template: asStr(session.template),
    plan: asStr(session.plan),
    billingLabel: asStr(session.billingLabel),
    gpuConfig: asStr(session.gpuConfig),
    status: session.status != null ? String(session.status) : null,
    statusLabel: asStr(session.statusLabel),
    settlementStatus: session.settlementStatus != null ? String(session.settlementStatus) : null,
    settlementStatusLabel:
      session.settlementStatusLabel != null ? String(session.settlementStatusLabel) : null,
    settlementAt: session.settlementAt != null ? String(session.settlementAt) : null,
    settlementBreakdown,
    settlementBreakdownSummary: formatSettlementBreakdownSummary(settlementBreakdown),
    verifiedRunningAt: session.verifiedRunningAt != null ? String(session.verifiedRunningAt) : null,
    verifiedDestroyedAt:
      session.verifiedDestroyedAt != null ? String(session.verifiedDestroyedAt) : null,
    verifyStatusLabel: formatVerifyStatusLabel(session),
    destroyReason: session.destroyReason != null ? String(session.destroyReason) : null,
    startedAt: session.startedAt != null ? String(session.startedAt) : null,
    endedAt: session.endedAt != null ? String(session.endedAt) : null,
    durationSeconds: Number(session.durationSeconds ?? 0),
    durationLabel: asStr(session.durationLabel),
    billableSeconds:
      session.billableSeconds != null ? Number(session.billableSeconds) : null,
    billableLabel: asStr(session.billableLabel),
    outputSummary: asStr(session.outputSummary),
    vramLabel: asStr(session.vramLabel),
    isLive: Boolean(session.isLive),
    isBillingHistory:
      session.settlementStatus === 'settled' || session.settlementStatus === 'skipped',
  };
}

/**
 * @param {unknown} breakdown
 */
export function formatSettlementBreakdownSummary(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') {
    return null;
  }

  const record = /** @type {Record<string, unknown>} */ (breakdown);
  const parts = [];

  if (record.chargedSeconds != null) {
    parts.push(`Tính phí: ${formatSecondsLabel(Number(record.chargedSeconds))}`);
  }
  if (record.walletCharge != null && Number(record.walletCharge) > 0) {
    parts.push(`Ví: ${Number(record.walletCharge).toLocaleString('vi-VN')}đ`);
  }
  if (Array.isArray(record.allocations) && record.allocations.length > 0) {
    parts.push(`${record.allocations.length} nguồn entitlement`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * @param {Record<string, unknown>} session
 */
export function formatVerifyStatusLabel(session) {
  if (session.verifiedDestroyedAt) {
    return 'destroy verified';
  }
  if (session.verifiedRunningAt) {
    return 'running verified';
  }
  return null;
}

/**
 * @param {Array<Record<string, unknown>>} sessions
 */
export function mapSessionsApiList(sessions) {
  /** @type {NonNullable<ReturnType<typeof mapSessionApiToHistoryView>>[]} */
  const views = [];
  for (const session of sessions ?? []) {
    const view = mapSessionApiToHistoryView(session);
    if (view) views.push(view);
  }
  return views;
}

/**
 * @param {NonNullable<ReturnType<typeof mapSessionApiToHistoryView>>[]} views
 */
export function filterBillingHistorySessions(views) {
  return views.filter((view) => view.isBillingHistory);
}
