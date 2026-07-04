/**
 * M11 — API → View Model mapping for Session-Centric Billing UI.
 * Display-only: no remaining formulas, no billing business rules.
 */

/**
 * @param {Record<string, unknown> | null | undefined} data
 */
export function mapMachineStatusApiToScbView(data) {
  return {
    remainingHours: toNullableNumber(data?.remainingHours),
    totalEntitlementHours: toNullableNumber(data?.totalEntitlementHours),
    sessionDurationSeconds: Math.max(0, Math.floor(Number(data?.sessionDurationSeconds ?? 0))),
    billingStartedAt: data?.billingStartedAt ?? null,
    sessionStatus: data?.sessionStatus ?? null,
    settlementStatus: data?.settlementStatus ?? null,
    verifiedRunningAt: data?.verifiedRunningAt ?? null,
    outOfHours: Boolean(data?.outOfHours),
    lowCreditWarning: Boolean(data?.lowCreditWarning),
  };
}

/**
 * @param {boolean} isMachineRunning
 * @param {ReturnType<typeof mapMachineStatusApiToScbView>} statusView
 * @param {{ remainingHours?: number | null; totalEntitlementHours?: number | null } | null} dashboardRemaining
 * @param {number | null | undefined} planInventoryHours
 */
export function pickPlanCardRemainingHours(
  isMachineRunning,
  statusView,
  dashboardRemaining,
  planInventoryHours,
) {
  if (isMachineRunning && statusView.remainingHours != null) {
    return statusView.remainingHours;
  }
  if (dashboardRemaining?.remainingHours != null) {
    return dashboardRemaining.remainingHours;
  }
  return planInventoryHours ?? 0;
}

/**
 * @param {ReturnType<typeof mapMachineStatusApiToScbView>} statusView
 * @param {{ totalEntitlementHours?: number | null } | null} dashboardRemaining
 * @param {number | null | undefined} planInventoryTotal
 */
export function pickPlanCardTotalHours(statusView, dashboardRemaining, planInventoryTotal) {
  if (statusView.totalEntitlementHours != null) {
    return statusView.totalEntitlementHours;
  }
  if (dashboardRemaining?.totalEntitlementHours != null) {
    return dashboardRemaining.totalEntitlementHours;
  }
  return planInventoryTotal ?? 0;
}

/**
 * @param {ReturnType<typeof mapMachineStatusApiToScbView>} statusView
 */
export function pickSessionRemainingHours(statusView) {
  return statusView.remainingHours;
}

/**
 * @param {Record<string, unknown> | null | undefined} data
 */
export function mapDestroyApiToScbView(data) {
  return {
    settlementStatus: typeof data?.settlementStatus === 'string' ? data.settlementStatus : null,
    verifyStatus: typeof data?.verifyStatus === 'string' ? data.verifyStatus : null,
    verifiedDestroyedAt:
      typeof data?.verifiedDestroyedAt === 'string' ? data.verifiedDestroyedAt : null,
    billableSeconds: Math.max(0, Math.floor(Number(data?.billableSeconds ?? 0))),
  };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function toNullableNumber(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Number(value);
}

/**
 * Presentation-only anchor for smooth session elapsed display (M11+).
 * Resync on each status poll via resolveSessionElapsedAnchor().
 *
 * @param {{ sessionDurationSeconds?: number; billingStartedAt?: string | null }} api
 * @param {number} [syncNowMs]
 * @returns {{ mode: 'duration'; baseSeconds: number; syncedAtMs: number } | { mode: 'startedAt'; startedMs: number }}
 */
export function resolveSessionElapsedAnchor(api, syncNowMs = Date.now()) {
  const baseSeconds = Math.max(0, Math.floor(Number(api?.sessionDurationSeconds ?? 0)));
  const startedMs = api?.billingStartedAt ? Date.parse(String(api.billingStartedAt)) : NaN;
  const hasStartedAt = Number.isFinite(startedMs);

  if (baseSeconds > 0) {
    return { mode: 'duration', baseSeconds, syncedAtMs: syncNowMs };
  }
  if (hasStartedAt) {
    return { mode: 'startedAt', startedMs };
  }
  return { mode: 'duration', baseSeconds: 0, syncedAtMs: syncNowMs };
}

/**
 * @param {ReturnType<typeof resolveSessionElapsedAnchor>|null|undefined} anchor
 * @param {number} [nowMs]
 */
export function computeSessionElapsedSeconds(anchor, nowMs = Date.now()) {
  if (!anchor) return 0;
  if (anchor.mode === 'startedAt') {
    return Math.max(0, Math.floor((nowMs - anchor.startedMs) / 1000));
  }
  return Math.max(0, anchor.baseSeconds + Math.floor((nowMs - anchor.syncedAtMs) / 1000));
}

/**
 * Presentation-only anchor for smooth remaining-hours display (M11+).
 * Resync on each status poll. No interpolation when API pair is incomplete.
 *
 * @param {number | null | undefined} remainingHours
 * @param {number | null | undefined} sessionDurationSeconds
 * @returns {{ remainingHours: number; sessionDurationSeconds: number } | null}
 */
export function resolveRemainingHoursAnchor(remainingHours, sessionDurationSeconds) {
  if (remainingHours == null || !Number.isFinite(Number(remainingHours))) return null;
  const duration = Math.max(0, Math.floor(Number(sessionDurationSeconds ?? 0)));
  if (duration <= 0) return null;
  return {
    remainingHours: Number(remainingHours),
    sessionDurationSeconds: duration,
  };
}

/**
 * Interpolate remaining hours from poll anchor + elapsed session clock (presentation only).
 *
 * @param {{ remainingHours: number; sessionDurationSeconds: number } | null | undefined} anchor
 * @param {number} currentElapsedSeconds
 * @returns {number | null} null when anchor missing — caller shows raw API value
 */
export function computeDisplayRemainingHours(anchor, currentElapsedSeconds) {
  if (!anchor) return null;
  const elapsed = Math.max(0, Math.floor(Number(currentElapsedSeconds ?? 0)));
  const deltaSeconds = Math.max(0, elapsed - anchor.sessionDurationSeconds);
  return Math.max(0, anchor.remainingHours - deltaSeconds / 3600);
}
