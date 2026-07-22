/**
 * Dual-run (“Render an toàn”) policy helpers — B3.1 / B3.3.
 * Spec: docs/architecture/ADR-006-dual-run-policy.md
 * Product: docs/GPUVietnam_TinhNang_RenderAnToan.md
 */

/** Hard cap: Render an toàn = đúng 2 GPU (Attempt A + Attempt B). Never more. */
export const DUAL_RUN_MAX_GPUS = 2;

/** Default customer-facing multipliers (overridden by Admin gpu_pricing_config.dualRun). */
export const DUAL_RUN_BILLING = Object.freeze({
  /** Charge vs equivalent single-run (Admin editable). */
  customerMultiplier: 1.65,
  /** Suggested marketing floor for copy (optional). */
  multiplierMin: 1.5,
  /** Suggested marketing ceiling for copy (optional). */
  multiplierMax: 1.8,
  /** Hard cap vs equivalent single-run charge. */
  hardCapMultiplier: 1.9,
  billLoserUntilCancel: true,
  /** Always require Attempt A/B on different hosts. */
  requireDistinctHosts: true,
  maxGpus: DUAL_RUN_MAX_GPUS,
});

export const DUAL_RUN_UX_COPY_VI = Object.freeze({
  title: 'Render an toàn (2 GPU)',
  short:
    'Chạy cùng một Job trên 2 máy cùng loại GPU gói đang dùng, bắt buộc khác host. Máy nào ra file bền trước sẽ thắng; máy còn lại bị hủy.',
  notResume:
    'Không phải resume CUDA giữa chừng — đây là hai Attempt độc lập trên hai Runtime / hai host.',
  insufficientHosts:
    'Chưa đủ 2 host khả dụng (khác máy) để bật Render an toàn. Hệ thống sẽ chạy chế độ 1 GPU.',
  sameHostForbidden:
    'Hai Attempt không được thuê cùng một host — mất ý nghĩa dự phòng độc lập.',
  maxGpusExceeded: `Render an toàn chỉ được thuê tối đa ${DUAL_RUN_MAX_GPUS} GPU.`,
  enabledToast: 'Đã bật Render an toàn cho Job này.',
  disabledToast: 'Đã tắt Render an toàn — Job chạy 1 Attempt.',
});

/**
 * Dual-run may rent at most DUAL_RUN_MAX_GPUS instances for one Job.
 * @param {number} gpuCount
 * @returns {{ ok: true } | { ok: false; code: 'DUAL_RUN_MAX_GPUS'; message: string; maxGpus: number }}
 */
export function assertDualRunGpuCap(gpuCount) {
  const n = Number(gpuCount);
  if (!Number.isFinite(n) || n <= DUAL_RUN_MAX_GPUS) {
    return { ok: true };
  }
  return {
    ok: false,
    code: 'DUAL_RUN_MAX_GPUS',
    message: DUAL_RUN_UX_COPY_VI.maxGpusExceeded,
    maxGpus: DUAL_RUN_MAX_GPUS,
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {{ min?: number; max?: number }} [bounds]
 */
function asMultiplier(value, fallback, bounds = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const min = bounds.min ?? 1;
  const max = bounds.max ?? 5;
  const clamped = Math.min(max, Math.max(min, num));
  return Math.round(clamped * 1000) / 1000;
}

/**
 * Normalize dual-run billing from Admin pricing config (or defaults).
 * @param {unknown} raw
 */
export function normalizeDualRunBilling(raw) {
  const source = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const customerMultiplier = asMultiplier(
    source.customerMultiplier ?? source.multiplier,
    DUAL_RUN_BILLING.customerMultiplier,
    { min: 1, max: 3 },
  );
  let hardCapMultiplier = asMultiplier(
    source.hardCapMultiplier,
    DUAL_RUN_BILLING.hardCapMultiplier,
    { min: 1, max: 5 },
  );
  if (hardCapMultiplier < customerMultiplier) {
    hardCapMultiplier = customerMultiplier;
  }
  return {
    customerMultiplier,
    multiplierMin: asMultiplier(source.multiplierMin, DUAL_RUN_BILLING.multiplierMin, {
      min: 1,
      max: 3,
    }),
    multiplierMax: asMultiplier(source.multiplierMax, DUAL_RUN_BILLING.multiplierMax, {
      min: 1,
      max: 3,
    }),
    hardCapMultiplier,
    billLoserUntilCancel: source.billLoserUntilCancel !== false,
    requireDistinctHosts: source.requireDistinctHosts !== false,
  };
}

/**
 * @param {unknown} [dualRunConfig]
 */
export function resolveDualRunBilling(dualRunConfig) {
  return normalizeDualRunBilling(dualRunConfig ?? DUAL_RUN_BILLING);
}

/**
 * @param {number} customerMultiplier
 * @param {number} hardCapMultiplier
 */
export function buildDualRunCostWarning(customerMultiplier, hardCapMultiplier) {
  const m = Number(customerMultiplier).toFixed(2).replace(/\.?0+$/, '');
  const cap = Number(hardCapMultiplier).toFixed(2).replace(/\.?0+$/, '');
  return `Chi phí khoảng ${m}× giá phiên thường (tối đa ${cap}×). Đổi lại giảm rủi ro gián đoạn khi một GPU/host chết.`;
}

/**
 * Normalize provider host identity for dual-run exclusion.
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeHostKey(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.toLowerCase();
}

/**
 * @param {unknown} hostKeyA
 * @param {unknown} hostKeyB
 */
export function assertDistinctHosts(hostKeyA, hostKeyB) {
  const a = normalizeHostKey(hostKeyA);
  const b = normalizeHostKey(hostKeyB);
  if (!a || !b) {
    return {
      ok: false,
      reason: 'missing_host_key',
      message: 'Chưa xác định được host của Attempt — không thể xác nhận khác host.',
      hostKeyA: a,
      hostKeyB: b,
    };
  }
  if (a === b) {
    return {
      ok: false,
      reason: 'same_host',
      message: DUAL_RUN_UX_COPY_VI.sameHostForbidden,
      hostKeyA: a,
      hostKeyB: b,
    };
  }
  return { ok: true, reason: 'distinct', hostKeyA: a, hostKeyB: b };
}

/**
 * Merge exclude lists (Attempt A host + bad-host TTL keys).
 * @param {Iterable<unknown>} [keys]
 * @returns {string[]}
 */
export function mergeExcludeHostKeys(keys = []) {
  const out = new Set();
  for (const key of keys) {
    const n = normalizeHostKey(key);
    if (n) out.add(n);
  }
  return [...out];
}

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
 *   hostKeyA?: string | null;
 *   hostKeyB?: string | null;
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

  if (input.hostKeyA != null || input.hostKeyB != null) {
    const distinct = assertDistinctHosts(input.hostKeyA, input.hostKeyB);
    if (!distinct.ok) {
      return {
        ok: false,
        mode: /** @type {const} */ ('single'),
        reason: distinct.reason,
        executionPolicy: 'single',
        message: distinct.message,
        hostKeyA: distinct.hostKeyA,
        hostKeyB: distinct.hostKeyB,
      };
    }
  }

  return {
    ok: true,
    mode: /** @type {const} */ ('dual_run'),
    reason: 'eligible',
    executionPolicy: 'dual_run',
    requireDistinctHosts: true,
  };
}

/**
 * Customer charge for dual-run = singleEquivalent × admin customerMultiplier,
 * never above hardCap. Raw winner+loser minutes kept for ops visibility.
 *
 * @param {{
 *   winnerMinutes: number;
 *   loserMinutes: number;
 *   singleRatePerMinute: number;
 * }} input
 * @param {ReturnType<typeof resolveDualRunBilling>} [billing]
 */
export function estimateDualRunCustomerCharge(input, billing = DUAL_RUN_BILLING) {
  const resolved = resolveDualRunBilling(billing);
  const rate = Math.max(0, Number(input.singleRatePerMinute) || 0);
  const winnerMin = Math.max(0, Number(input.winnerMinutes) || 0);
  const loserMin = Math.max(0, Number(input.loserMinutes) || 0);
  const raw = rate * (winnerMin + loserMin);
  const singleEquivalent = rate * winnerMin;
  const byAdminMultiplier = singleEquivalent * resolved.customerMultiplier;
  const hardCap = singleEquivalent * resolved.hardCapMultiplier;
  const capped = Math.min(byAdminMultiplier, hardCap);
  const multiplier =
    singleEquivalent > 0 ? capped / singleEquivalent : resolved.customerMultiplier;

  return {
    rawCharge: raw,
    cappedCharge: capped,
    singleEquivalentCharge: singleEquivalent,
    effectiveMultiplier: Number(multiplier.toFixed(3)),
    customerMultiplier: resolved.customerMultiplier,
    hardCapMultiplier: resolved.hardCapMultiplier,
    withinSuggestedBand:
      multiplier >= resolved.customerMultiplier - 0.01 &&
      multiplier <= resolved.hardCapMultiplier + 0.01,
  };
}

/**
 * Apply Admin dual-run multiplier to a single-session charge (VND).
 * @param {number} singleSessionChargeVnd
 * @param {unknown} [billing]
 */
export function applyDualRunPriceMultiplier(singleSessionChargeVnd, billing = DUAL_RUN_BILLING) {
  const resolved = resolveDualRunBilling(billing);
  const base = Math.max(0, Number(singleSessionChargeVnd) || 0);
  const byAdmin = base * resolved.customerMultiplier;
  const hardCap = base * resolved.hardCapMultiplier;
  return {
    singleCharge: base,
    dualCharge: Math.min(byAdmin, hardCap),
    customerMultiplier: resolved.customerMultiplier,
    hardCapMultiplier: resolved.hardCapMultiplier,
    effectiveMultiplier:
      base > 0 ? Number((Math.min(byAdmin, hardCap) / base).toFixed(3)) : resolved.customerMultiplier,
  };
}

/**
 * Dashboard / API payload for toggle UX.
 * @param {{
 *   planKey?: string | null;
 *   enabled?: boolean;
 *   availableHostCount?: number | null;
 *   billing?: unknown;
 *   gpuLine?: string | null;
 *   capacityMessage?: string | null;
 * }} input
 */
export function buildDualRunUxState(input = {}) {
  const billing = resolveDualRunBilling(input.billing);
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
    costWarning: buildDualRunCostWarning(
      billing.customerMultiplier,
      billing.hardCapMultiplier,
    ),
    notResume: DUAL_RUN_UX_COPY_VI.notResume,
    sameGpuNote:
      'GPU thứ 2 cùng loại với gói đang dùng (ví dụ Pro → RTX 4090), bắt buộc khác host.',
    enabled: userEnabled,
    canEnable,
    eligibility,
    requireDistinctHosts: true,
    maxGpus: DUAL_RUN_MAX_GPUS,
    gpuLine: input.gpuLine ?? null,
    capacityMessage: input.capacityMessage ?? null,
    billing: {
      customerMultiplier: billing.customerMultiplier,
      multiplierMin: billing.multiplierMin,
      multiplierMax: billing.multiplierMax,
      hardCapMultiplier: billing.hardCapMultiplier,
      maxGpus: DUAL_RUN_MAX_GPUS,
    },
  };
}
