/**
 * Session-Centric Billing — Remaining Time domain service (M2).
 * Pure read-only calculations. No DB, no side effects.
 * Domain values use full precision — no rounding (presentation layer formats display).
 * @see docs/SESSION_CENTRIC_BILLING_ARCHITECTURE.md §3
 */

import { parseValidSessionStartedMs } from './billing-anchor-core.js';

/** @typedef {{ nowMs: () => number, now: () => Date }} RemainingClock */

/** @typedef {'gift'|'combo'|'hourly'|string} EntitlementPlanType */

/**
 * @typedef {Object} EntitlementPlanSnapshot
 * @property {EntitlementPlanType} plan_type
 * @property {number|string|null} [hours_remaining]
 * @property {number|string|null} [price_per_hour]
 * @property {string|null} [valid_until]
 * @property {string} [status]
 */

/**
 * @typedef {Object} SessionSnapshot
 * @property {string} [status]
 * @property {string|null} [started_at]
 * @property {string|null} [verified_running_at]
 * @property {string|null} [ended_at]
 * @property {string|null} [settlement_status]
 */

/**
 * @typedef {Object} RemainingSnapshot
 * @property {EntitlementPlanSnapshot[]} [entitlementPlans]
 * @property {number|string|null} [walletBalance]
 * @property {SessionSnapshot[]} [sessions]
 * @property {boolean} [providerRunningVerified]
 */

/**
 * @typedef {Object} RemainingBreakdownOk
 * @property {'OK'} state
 * @property {number} remainingHours
 * @property {number} totalEntitlementHours
 * @property {number} settledSessionUsageHours
 * @property {number} currentSessionElapsedHours
 * @property {'hourly'|'combo'} primaryPlanType
 */

/**
 * @typedef {Object} RemainingBreakdownInvalid
 * @property {'INVALID_STATE'} state
 * @property {string} code
 * @property {string} message
 * @property {number} [runningSessionCount]
 */

/** @typedef {RemainingBreakdownOk | RemainingBreakdownInvalid} RemainingResult */

export const REMAINING_STATE_OK = 'OK';
export const REMAINING_INVALID_STATE = 'INVALID_STATE';
export const REMAINING_ERROR_MULTIPLE_RUNNING_SESSIONS = 'MULTIPLE_RUNNING_SESSIONS';

const MS_PER_HOUR = 3600 * 1000;

export class RemainingInvariantError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RemainingInvariantError';
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.details = details;
  }
}

/** @returns {RemainingClock} */
export function systemClock() {
  return {
    nowMs: () => Date.now(),
    now: () => new Date(),
  };
}

/**
 * Fixed clock for deterministic tests.
 * @param {number|string|Date} at
 * @returns {RemainingClock}
 */
export function createClock(at) {
  const ms =
    at instanceof Date
      ? at.getTime()
      : typeof at === 'number'
        ? at
        : new Date(String(at)).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error('createClock: invalid timestamp');
  }
  return {
    nowMs: () => ms,
    now: () => new Date(ms),
  };
}

/**
 * Floor remaining at zero — full precision, no rounding.
 * @param {number} hours
 * @returns {number}
 */
export function clampRemainingHours(hours) {
  return Math.max(0, Number(hours));
}

/**
 * @param {string|number|Date|null|undefined} value
 * @returns {number|null}
 */
export function parseTimestampMs(value) {
  if (value == null || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {SessionSnapshot[]} sessions
 * @returns {SessionSnapshot[]}
 */
function getRunningSessions(sessions) {
  return sessions.filter((s) => s.status === 'running');
}

/**
 * @param {SessionSnapshot[]} sessions
 * @returns {SessionSnapshot[]}
 */
export function assertAtMostOneRunningSession(sessions) {
  const running = getRunningSessions(sessions);
  if (running.length > 1) {
    throw new RemainingInvariantError(
      REMAINING_ERROR_MULTIPLE_RUNNING_SESSIONS,
      `Expected at most one running session, found ${running.length}`,
      { runningSessionCount: running.length },
    );
  }
  return running;
}

/**
 * Billable seconds between two instants (derived — not from duration_seconds).
 * @param {string|number|Date|null|undefined} startedAt
 * @param {string|number|Date|null|undefined} endedAt
 * @returns {number}
 */
export function calculateSessionBillableSeconds(startedAt, endedAt) {
  const startMs = parseTimestampMs(startedAt);
  const endMs = parseTimestampMs(endedAt);
  if (startMs == null || endMs == null) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

/**
 * @param {EntitlementPlanSnapshot} plan
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isUsableEntitlementPlan(plan, nowMs) {
  if (!plan || plan.status !== 'active') return false;
  if (plan.valid_until) {
    const expiryMs = parseTimestampMs(plan.valid_until);
    if (expiryMs != null && expiryMs <= nowMs) return false;
  }
  if (plan.plan_type === 'hourly') return true;
  return Number(plan.hours_remaining ?? 0) > 0;
}

/**
 * Total entitlement hours at `now`: gift + combo (hour packages) + wallet→hours (hourly plan).
 * Does not subtract settled or running usage.
 *
 * @param {RemainingSnapshot|{ entitlementPlans?: EntitlementPlanSnapshot[], walletBalance?: number|string|null }} snapshot
 * @param {RemainingClock} [clock]
 * @returns {number}
 */
export function calculateTotalEntitlement(snapshot, clock = systemClock()) {
  const plans = snapshot.entitlementPlans ?? [];
  const walletBalance = Number(snapshot.walletBalance ?? 0);
  const nowMs = clock.nowMs();

  let giftComboHours = 0;
  /** @type {EntitlementPlanSnapshot|null} */
  let hourlyPlan = null;

  for (const plan of plans) {
    if (!isUsableEntitlementPlan(plan, nowMs)) continue;
    if (plan.plan_type === 'hourly') {
      hourlyPlan = plan;
      continue;
    }
    giftComboHours += Number(plan.hours_remaining ?? 0);
  }

  let walletHours = 0;
  if (hourlyPlan) {
    const pricePerHour = Number(hourlyPlan.price_per_hour ?? 0);
    if (pricePerHour > 0) {
      walletHours = walletBalance / pricePerHour;
    }
  }

  return giftComboHours + walletHours;
}

/**
 * Sum of billable duration for settled sessions only (seconds → hours).
 * Uses ended_at − started_at only.
 *
 * @param {RemainingSnapshot|{ sessions?: SessionSnapshot[] }} snapshot
 * @returns {number}
 */
export function calculateSettledUsage(snapshot) {
  const sessions = snapshot.sessions ?? [];
  let totalSeconds = 0;

  for (const session of sessions) {
    if (session.settlement_status !== 'settled') continue;
    totalSeconds += calculateSessionBillableSeconds(session.started_at, session.ended_at);
  }

  return totalSeconds / 3600;
}

/**
 * Elapsed hours for the single running session, or 0 when none.
 * Requires providerRunningVerified === true (SCB R4).
 * Throws {@link RemainingInvariantError} when more than one running session (invariant violation).
 *
 * @param {RemainingSnapshot} snapshot
 * @param {RemainingClock} [clock]
 * @returns {number}
 */
export function calculateCurrentSessionElapsed(snapshot, clock = systemClock()) {
  const sessions = snapshot.sessions ?? [];
  const running = assertAtMostOneRunningSession(sessions);

  if (running.length === 0) return 0;
  if (!snapshot.providerRunningVerified) return 0;

  const session = running[0];
  const startedMs =
    parseValidSessionStartedMs(session.started_at) ??
    parseValidSessionStartedMs(session.verified_running_at);
  if (startedMs == null) return 0;

  const elapsedMs = Math.max(0, clock.nowMs() - startedMs);
  return elapsedMs / MS_PER_HOUR;
}

/**
 * @param {EntitlementPlanSnapshot[]} plans
 * @param {number} nowMs
 * @returns {'hourly'|'combo'}
 */
export function resolvePrimaryPlanType(plans, nowMs) {
  for (const plan of plans) {
    if (isUsableEntitlementPlan(plan, nowMs) && plan.plan_type === 'hourly') {
      return 'hourly';
    }
  }
  return 'combo';
}

/**
 * Remaining = TotalEntitlement − SettledSessionUsage − CurrentSessionElapsed (clamped ≥ 0).
 * Returns {@link RemainingBreakdownInvalid} when session invariants are violated.
 *
 * @param {RemainingSnapshot} snapshot
 * @param {RemainingClock} [clock]
 * @returns {RemainingResult}
 */
export function calculateRemaining(snapshot, clock = systemClock()) {
  const sessions = snapshot.sessions ?? [];
  const running = getRunningSessions(sessions);

  if (running.length > 1) {
    return {
      state: REMAINING_INVALID_STATE,
      code: REMAINING_ERROR_MULTIPLE_RUNNING_SESSIONS,
      message: `Expected at most one running session, found ${running.length}`,
      runningSessionCount: running.length,
    };
  }

  const nowMs = clock.nowMs();
  const totalEntitlementHours = calculateTotalEntitlement(snapshot, clock);
  const settledSessionUsageHours = calculateSettledUsage(snapshot, clock);
  const currentSessionElapsedHours = calculateCurrentSessionElapsed(snapshot, clock);
  const rawRemaining =
    totalEntitlementHours - settledSessionUsageHours - currentSessionElapsedHours;

  return {
    state: REMAINING_STATE_OK,
    remainingHours: clampRemainingHours(rawRemaining),
    totalEntitlementHours,
    settledSessionUsageHours,
    currentSessionElapsedHours,
    primaryPlanType: resolvePrimaryPlanType(snapshot.entitlementPlans ?? [], nowMs),
  };
}

/**
 * SCB §3.3 — derive out-of-credit from Remaining breakdown.
 * Caller must pass an OK breakdown (`state === 'OK'`).
 *
 * @param {RemainingBreakdownOk & { walletBalance?: number|string|null }} breakdown
 * @returns {boolean}
 */
export function isOutOfCredit(breakdown) {
  if (breakdown.remainingHours <= 0) return true;
  if (breakdown.primaryPlanType === 'hourly') {
    const walletBalance = Number(breakdown.walletBalance ?? 0);
    if (walletBalance <= 0) return true;
  }
  return false;
}
