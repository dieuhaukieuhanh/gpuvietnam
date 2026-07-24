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
 * @property {number|string} [id]
 * @property {EntitlementPlanType} plan_type
 * @property {string} [plan_name]
 * @property {string} [planName]
 * @property {string} [plan]
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
 * @property {Record<string, unknown>|null} [machine]
 */

/**
 * @typedef {Object} RemainingBreakdownOk
 * @property {'OK'} state
 * @property {number} remainingHours
 * @property {number} [packagePoolHours]
 * @property {number} [packageRemainingHours]
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

/** @type {Record<string, 'starter'|'pro'|'studio'>} */
const GPU_LINE_TO_PLAN_KEY = {
  rtx3090: 'starter',
  rtx4090_1x: 'pro',
  rtx4090_2x: 'studio',
  rtx5090_1x: 'studio',
};

/**
 * Normalize Starter/Pro/Studio package key from inventory / subscription labels.
 * @param {unknown} value
 * @returns {'starter'|'pro'|'studio'|null}
 */
export function normalizeEntitlementPlanKey(value) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw === 'starter' || raw.includes('starter') || raw.includes('3090')) return 'starter';
  if (
    raw === 'studio' ||
    raw.includes('studio') ||
    raw.includes('5090') ||
    /2\s*x.*4090|4090.*2\s*x/.test(raw)
  ) {
    return 'studio';
  }
  if (raw === 'pro' || raw.includes('pro') || raw.includes('4090')) return 'pro';
  if (raw in GPU_LINE_TO_PLAN_KEY) return GPU_LINE_TO_PLAN_KEY[raw];
  return null;
}

/**
 * Resolve which package (Starter/Pro/Studio) a running machine is consuming.
 * Prefer subscription-linked inventory when it disagrees with billing_inventory_id
 * (stale gift burn pointer), then inventory row, then GPU line / plan fields.
 *
 * @param {Record<string, unknown> | null | undefined} machine
 * @param {EntitlementPlanSnapshot[]} [plans]
 * @returns {'starter'|'pro'|'studio'|null}
 */
export function resolveMachinePlanKey(machine, plans = []) {
  if (!machine || typeof machine !== 'object') return null;

  const list = plans ?? [];
  const subId =
    machine.subscription_id != null && String(machine.subscription_id).trim() !== ''
      ? String(machine.subscription_id)
      : null;
  let fromSubscription = null;
  if (subId) {
    const matchedSub = list.find((plan) => String(plan.subscription_id ?? '') === subId);
    fromSubscription = normalizeEntitlementPlanKey(
      matchedSub?.plan_name ?? matchedSub?.planName ?? matchedSub?.plan,
    );
  }

  const inventoryId =
    machine.billing_inventory_id != null ? Number(machine.billing_inventory_id) : NaN;
  let fromInventory = null;
  if (Number.isFinite(inventoryId) && inventoryId > 0) {
    const matched = list.find((plan) => Number(plan.id) === inventoryId);
    fromInventory = normalizeEntitlementPlanKey(
      matched?.plan_name ?? matched?.planName ?? matched?.plan,
    );
  }

  // Wrong inventory id must not re-scope Card/remaining to another package.
  if (fromSubscription && fromInventory && fromSubscription !== fromInventory) {
    return fromSubscription;
  }
  if (fromInventory) return fromInventory;
  if (fromSubscription) return fromSubscription;

  const fromGpuLine = normalizeEntitlementPlanKey(machine.gpu_line ?? machine.gpu_type);
  if (fromGpuLine) return fromGpuLine;

  return normalizeEntitlementPlanKey(machine.plan ?? machine.plan_name ?? machine.gpu_label);
}

/**
 * Pick the inventory row a session should burn for this machine.
 * Scopes to the machine's package (subscription / plan key) before gift-first burn order.
 *
 * @param {EntitlementPlanSnapshot[]} plans — already burn-ordered
 * @param {Record<string, unknown> | null | undefined} machine
 * @param {{ plan?: unknown } | null | undefined} [subscription]
 * @returns {EntitlementPlanSnapshot | null}
 */
export function selectPrimaryBillablePlanForMachine(plans, machine, subscription = null) {
  const list = Array.isArray(plans) ? plans : [];
  if (list.length === 0) return null;

  const planKey =
    normalizeEntitlementPlanKey(subscription?.plan) ||
    resolveMachinePlanKey(machine, list) ||
    normalizeEntitlementPlanKey(
      list.find((p) => p.is_active)?.plan_name ??
        list.find((p) => p.is_active)?.planName ??
        list.find((p) => p.is_active)?.plan,
    );

  const scoped = planKey
    ? list.filter((plan) => {
        const key = normalizeEntitlementPlanKey(plan.plan_name ?? plan.planName ?? plan.plan);
        return key === planKey;
      })
    : list;
  const pool = scoped.length > 0 ? scoped : list;

  const inventoryId =
    machine?.billing_inventory_id != null ? Number(machine.billing_inventory_id) : NaN;
  if (Number.isFinite(inventoryId) && inventoryId > 0) {
    const existing = pool.find((plan) => Number(plan.id) === inventoryId);
    if (existing) return existing;
  }

  // `plans` is already soonest-expiry burn-ordered; keep that within the package.
  return pool[0] ?? null;
}

/**
 * Keep only entitlement rows for the machine's active package.
 * When plan key cannot be resolved, returns all plans (backward compatible).
 *
 * @param {EntitlementPlanSnapshot[]} plans
 * @param {Record<string, unknown> | null | undefined} machine
 * @returns {EntitlementPlanSnapshot[]}
 */
export function filterEntitlementPlansForMachine(plans, machine) {
  const list = plans ?? [];
  const planKey = resolveMachinePlanKey(machine, list);
  if (!planKey) return list;

  const filtered = list.filter((plan) => {
    const key = normalizeEntitlementPlanKey(plan.plan_name ?? plan.planName ?? plan.plan);
    return key === planKey;
  });

  // If inventory rows lack plan_name, avoid emptying entitlement by accident.
  return filtered.length > 0 ? filtered : list;
}

/**
 * Prepaid package hour pool for the (machine-scoped) package:
 * gift + combo + prepaid giờ lẻ (hourly.hours_remaining). Excludes ví→hourly.
 *
 * @param {RemainingSnapshot|{ entitlementPlans?: EntitlementPlanSnapshot[], machine?: Record<string, unknown>|null }} snapshot
 * @param {RemainingClock} [clock]
 * @returns {number}
 */
export function calculateGiftComboEntitlement(snapshot, clock = systemClock()) {
  const plans = filterEntitlementPlansForMachine(
    snapshot.entitlementPlans ?? [],
    snapshot.machine,
  );
  const nowMs = clock.nowMs();
  let packageHours = 0;
  for (const plan of plans) {
    if (!isUsableEntitlementPlan(plan, nowMs)) continue;
    // Wallet burn is separate; prepaid hours_remaining on hourly counts as package hours.
    packageHours += Number(plan.hours_remaining ?? 0);
  }
  return packageHours;
}

/**
 * Total entitlement hours at `now`: gift + combo (hour packages) + wallet→hours (hourly plan).
 * Does not subtract settled or running usage.
 *
 * When `snapshot.machine` is set, only hours for that machine's package
 * (Starter / Pro / Studio) are counted — other packages do not keep the machine alive.
 *
 * @param {RemainingSnapshot|{ entitlementPlans?: EntitlementPlanSnapshot[], walletBalance?: number|string|null, machine?: Record<string, unknown>|null }} snapshot
 * @param {RemainingClock} [clock]
 * @returns {number}
 */
export function calculateTotalEntitlement(snapshot, clock = systemClock()) {
  const plans = filterEntitlementPlansForMachine(
    snapshot.entitlementPlans ?? [],
    snapshot.machine,
  );
  const walletBalance = Number(snapshot.walletBalance ?? 0);
  const nowMs = clock.nowMs();

  const giftComboHours = calculateGiftComboEntitlement(snapshot, clock);
  /** @type {EntitlementPlanSnapshot|null} */
  let hourlyPlan = null;

  for (const plan of plans) {
    if (!isUsableEntitlementPlan(plan, nowMs)) continue;
    if (plan.plan_type === 'hourly') {
      hourlyPlan = plan;
    }
  }

  let walletHours = 0;
  if (hourlyPlan) {
    const pricePerHour = Number(hourlyPlan.price_per_hour ?? 0);
    if (pricePerHour > 0) {
      walletHours = walletBalance / pricePerHour;
    }
  }

  // giftComboHours already includes prepaid hourly.hours_remaining; add ví only.
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
    // Skip corrupt / epoch anchors — same guard as live session elapsed.
    if (parseValidSessionStartedMs(session.started_at) == null) continue;
    const seconds = calculateSessionBillableSeconds(session.started_at, session.ended_at);
    // Cap absurd durations so one bad row cannot dominate diagnostics.
    if (seconds > 7 * 24 * 3600) continue;
    totalSeconds += seconds;
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
 * Remaining = TotalEntitlement − CurrentSessionElapsed (clamped ≥ 0).
 *
 * `hours_remaining` on inventory / grants is already post-settlement (W6).
 * Historical settled session durations must **not** be subtracted again —
 * that double-counts and falsely drives auto-renew when users have large
 * settled history (or corrupt epoch `started_at` rows).
 *
 * When `snapshot.machine` is set (running session / auto-stop):
 * - TotalEntitlement is scoped to that machine's package only (Starter/Pro/Studio).
 * - Past sessions on other packages must not zero out the active package.
 *
 * `settledSessionUsageHours` is still computed for diagnostics / projections,
 * but is not applied to `remainingHours`.
 *
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
  const scopedPlans = filterEntitlementPlansForMachine(
    snapshot.entitlementPlans ?? [],
    snapshot.machine,
  );
  const totalEntitlementHours = calculateTotalEntitlement(snapshot, clock);
  const packagePoolHours = calculateGiftComboEntitlement(snapshot, clock);
  const settledSessionUsageHours = calculateSettledUsage(snapshot, clock);
  const currentSessionElapsedHours = calculateCurrentSessionElapsed(snapshot, clock);
  const rawRemaining = totalEntitlementHours - currentSessionElapsedHours;
  // Plan/session card: prepaid package pool (gift+combo+giờ lẻ), no ví.
  // Fall back to full remaining when pool empty (wallet-only hourly).
  const rawPackageRemaining =
    packagePoolHours > 0
      ? packagePoolHours - currentSessionElapsedHours
      : rawRemaining;

  return {
    state: REMAINING_STATE_OK,
    remainingHours: clampRemainingHours(rawRemaining),
    packagePoolHours,
    packageRemainingHours: clampRemainingHours(rawPackageRemaining),
    totalEntitlementHours,
    settledSessionUsageHours,
    currentSessionElapsedHours,
    primaryPlanType: resolvePrimaryPlanType(scopedPlans, nowMs),
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
