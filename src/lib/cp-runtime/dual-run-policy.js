/**
 * Dual-run (“Render an toàn”) policy helpers — B3.1 / B3.3.
 * Spec: docs/architecture/ADR-006-dual-run-policy.md
 */

/** Customer-facing multiplier band (product note). */
export const DUAL_RUN_BILLING = Object.freeze({
  /** Suggested marketing range vs single session */
  multiplierMin: 1.5,
  multiplierMax: 1.8,
  /** Hard cap vs equivalent single-run charge */
  hardCapMultiplier: 1.9,
  /** Loser billed only until cancel time (policy text). */
  billLoserUntilCancel: true,
});

export const DUAL_RUN_UX_COPY_VI = Object.freeze({
  title: 'Render an toàn (2 GPU)',
  short:
    'Chạy cùng một Job trên 2 máy song song. Máy nào ra file bền trước sẽ thắng; máy còn lại bị hủy.',
  costWarning:
    'Chi phí cao hơn phiên thường khoảng 50–80% (tối đa ~1.9×), đổi lại giảm rủi ro gián đoạn khi một GPU chết.',
  notResume:
    'Không phải resume CUDA giữa chừng — đây là hai Attempt độc lập trên hai Runtime.',
  insufficientHosts:
    'Chưa đủ 2 máy khả dụng để bật Render an toàn. Hệ thống sẽ chạy chế độ 1 GPU.',
  enabledToast: 'Đã bật Render an toàn cho Job này.',
  disabledToast: 'Đã tắt Render an toàn — Job chạy 1 Attempt.',
});

/**
 * Plans allowed to enable dual-run by default (product note: Pro/Studio).
 * Override with GPUVIETNAM_DUAL_RUN_ALL_PLANS=1.
 * @param {string | null | undefined} planKey
 */
export function isDualRunAllowedForPlan(planKey) {
  if (String(process.env.GPUVIETNAM_DUAL_RUN_ALL_PLANS ?? '').trim() === '1') {
    return true;
  }
  const key = String(planKey ?? '')
    .trim()
    .toLowerCase();
  if (!key) return false;
  if (key === 'pro' || key === 'studio') return true;
  if (/\bpro\b/.test(key) || /\bstudio\b/.test(key)) return true;
  return false;
}

/**
 * @param {{
 *   enabled?: boolean;
 *   planKey?: string | null;
 *   availableHostCount?: number | null;
 * }} input
 */
export function evaluateDualRunEligibility(input = {}) {
  const want = Boolean(input.enabled);
  if (!want) {
    return {
      ok: true,
      mode: /** @type {const} */ ('single'),
      reason: 'disabled',
      executionPolicy: 'single',
    };
  }

  if (!isDualRunAllowedForPlan(input.planKey)) {
    return {
      ok: false,
      mode: /** @type {const} */ ('single'),
      reason: 'plan_not_allowed',
      executionPolicy: 'single',
      message: 'Render an toàn hiện hỗ trợ gói Pro / Studio.',
    };
  }

  const hosts = input.availableHostCount;
  if (hosts != null && Number(hosts) < 2) {
    return {
      ok: false,
      mode: /** @type {const} */ ('single'),
      reason: 'insufficient_hosts',
      executionPolicy: 'single',
      message: DUAL_RUN_UX_COPY_VI.insufficientHosts,
    };
  }

  return {
    ok: true,
    mode: /** @type {const} */ ('dual_run'),
    reason: 'eligible',
    executionPolicy: 'dual_run',
  };
}

/**
 * Estimate customer charge multiplier (not SCB core billing).
 * @param {{
 *   winnerMinutes: number;
 *   loserMinutes: number;
 *   singleRatePerMinute: number;
 * }} input
 */
export function estimateDualRunCustomerCharge(input) {
  const rate = Math.max(0, Number(input.singleRatePerMinute) || 0);
  const winnerMin = Math.max(0, Number(input.winnerMinutes) || 0);
  const loserMin = Math.max(0, Number(input.loserMinutes) || 0);
  const raw = rate * (winnerMin + loserMin);
  const singleEquivalent = rate * winnerMin;
  const capped = Math.min(
    raw,
    singleEquivalent * DUAL_RUN_BILLING.hardCapMultiplier,
  );
  const multiplier =
    singleEquivalent > 0 ? capped / singleEquivalent : DUAL_RUN_BILLING.multiplierMin;

  return {
    rawCharge: raw,
    cappedCharge: capped,
    singleEquivalentCharge: singleEquivalent,
    effectiveMultiplier: Number(multiplier.toFixed(3)),
    hardCapMultiplier: DUAL_RUN_BILLING.hardCapMultiplier,
    withinSuggestedBand:
      multiplier >= DUAL_RUN_BILLING.multiplierMin - 0.05 &&
      multiplier <= DUAL_RUN_BILLING.hardCapMultiplier + 0.01,
  };
}

/**
 * Dashboard / API payload for toggle UX.
 * @param {{ planKey?: string | null; enabled?: boolean; availableHostCount?: number | null }} input
 */
export function buildDualRunUxState(input = {}) {
  const planOk = isDualRunAllowedForPlan(input.planKey);
  const hostsOk =
    input.availableHostCount == null || Number(input.availableHostCount) >= 2;
  const canEnable = planOk && hostsOk;
  const userEnabled = Boolean(input.enabled) && canEnable;
  const eligibility = evaluateDualRunEligibility({
    enabled: Boolean(input.enabled),
    planKey: input.planKey,
    availableHostCount: input.availableHostCount,
  });

  return {
    title: DUAL_RUN_UX_COPY_VI.title,
    short: DUAL_RUN_UX_COPY_VI.short,
    costWarning: DUAL_RUN_UX_COPY_VI.costWarning,
    notResume: DUAL_RUN_UX_COPY_VI.notResume,
    enabled: userEnabled,
    canEnable,
    eligibility,
    billing: {
      multiplierMin: DUAL_RUN_BILLING.multiplierMin,
      multiplierMax: DUAL_RUN_BILLING.multiplierMax,
      hardCapMultiplier: DUAL_RUN_BILLING.hardCapMultiplier,
    },
  };
}
