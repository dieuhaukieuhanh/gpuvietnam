/**
 * Settlement Domain — pure core (M6).
 * Billable duration, entitlement cap, allocation order, eligibility.
 * No DB, HTTP, or side effects.
 * @see docs/SESSION_CENTRIC_BILLING_ARCHITECTURE.md §6
 */

import { calculateSessionBillableSeconds } from './remaining-time.js';

export const SETTLEMENT_MODULE_VERSION = '1.0';

export const SETTLEMENT_ERROR_CODE = Object.freeze({
  SESSION_NOT_FOUND: 'SETTLEMENT_SESSION_NOT_FOUND',
  SESSION_NOT_CLOSED: 'SETTLEMENT_SESSION_NOT_CLOSED',
  ENDED_AT_MISSING: 'SETTLEMENT_ENDED_AT_MISSING',
  VERIFY_NOT_DESTROYED: 'SETTLEMENT_VERIFY_NOT_DESTROYED',
  ALREADY_SETTLED: 'SETTLEMENT_ALREADY_SETTLED',
  ALREADY_SKIPPED: 'SETTLEMENT_ALREADY_SKIPPED',
  TERMINAL_STATUS: 'SETTLEMENT_TERMINAL_STATUS',
  INVALID_SETTLEMENT_STATE: 'SETTLEMENT_INVALID_STATE',
  COMMIT_FAILED: 'SETTLEMENT_COMMIT_FAILED',
});

/** @typedef {'not_applicable'|'awaiting_verify'|'pending'|'in_progress'|'settled'|'skipped'|'failed'} SettlementStatus */

export const TERMINAL_SETTLEMENT_STATUSES = Object.freeze(['settled', 'skipped']);

export const SETTLEABLE_SETTLEMENT_STATUSES = Object.freeze([
  'pending',
  'failed',
  'in_progress',
  'awaiting_verify',
]);

const CLOSED_SESSION_STATUSES = Object.freeze(['closed', 'completed']);

/**
 * @param {unknown} value
 * @returns {number}
 */
function roundHours(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Billable seconds from session timestamps only (SCB INV-9).
 * @param {string|Date|null|undefined} startedAt
 * @param {string|Date|null|undefined} endedAt
 * @returns {number}
 */
export function calculateBillableSeconds(startedAt, endedAt) {
  return calculateSessionBillableSeconds(startedAt, endedAt);
}

/**
 * Allocation tier: manual grant → gift → combo → hourly wallet (SCB §6.3 + M6).
 * @param {Record<string, unknown>} plan
 * @returns {number}
 */
export function settlementPlanTier(plan) {
  if (plan?.grant_id != null && plan.grant_id !== '') return 0;
  if (plan?.plan_type === 'gift') return 1;
  if (plan?.plan_type === 'combo') return 2;
  if (plan?.plan_type === 'hourly') return 3;
  return 4;
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @returns {number}
 */
export function compareSettlementPlanPriority(a, b) {
  const tierDiff = settlementPlanTier(a) - settlementPlanTier(b);
  if (tierDiff !== 0) return tierDiff;

  const tier = settlementPlanTier(a);
  if (tier === 0 || tier === 1) {
    const aExpiry = a.valid_until ? new Date(String(a.valid_until)).getTime() : Number.MAX_SAFE_INTEGER;
    const bExpiry = b.valid_until ? new Date(String(b.valid_until)).getTime() : Number.MAX_SAFE_INTEGER;
    if (aExpiry !== bExpiry) return aExpiry - bExpiry;
  }

  const aId = Number(a.id ?? 0);
  const bId = Number(b.id ?? 0);
  return aId - bId;
}

/**
 * @param {Record<string, unknown>} row
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isSettlementPlanUsable(row, nowMs = Date.now()) {
  if (!row || row.status !== 'active') return false;
  if (row.valid_until) {
    const expiryMs = new Date(String(row.valid_until)).getTime();
    if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) return false;
  }
  if (row.plan_type === 'hourly') return true;
  return Number(row.hours_remaining ?? 0) > 0;
}

/**
 * @param {Record<string, unknown>[]} plans
 * @param {number} [nowMs]
 * @returns {Record<string, unknown>[]}
 */
export function orderPlansForSettlement(plans, nowMs = Date.now()) {
  return [...(plans ?? [])]
    .filter((row) => isSettlementPlanUsable(row, nowMs))
    .sort((a, b) => compareSettlementPlanPriority(a, b, nowMs));
}

/**
 * @param {Record<string, unknown>[]} plans
 * @param {number} walletBalance
 * @param {number} [nowMs]
 * @returns {number}
 */
export function computeAvailableEntitlementSeconds(plans, walletBalance, nowMs = Date.now()) {
  const ordered = orderPlansForSettlement(plans, nowMs);
  let seconds = 0;

  for (const plan of ordered) {
    if (plan.plan_type === 'hourly') {
      const pricePerHour = Number(plan.price_per_hour ?? 0);
      const balance = Number(walletBalance ?? 0);
      if (pricePerHour > 0 && balance > 0) {
        seconds += Math.floor((balance / pricePerHour) * 3600);
      }
      continue;
    }
    seconds += Math.floor(Number(plan.hours_remaining ?? 0) * 3600);
  }

  return seconds;
}

/**
 * @param {number} billableSeconds
 * @param {number} availableSeconds
 * @returns {{ chargeSeconds: number; capAppliedSeconds: number|null }}
 */
export function capChargeSeconds(billableSeconds, availableSeconds) {
  const billable = Math.max(0, Math.floor(billableSeconds));
  const available = Math.max(0, Math.floor(availableSeconds));
  const chargeSeconds = Math.min(billable, available);
  const capAppliedSeconds = chargeSeconds < billable ? billable - chargeSeconds : null;
  return { chargeSeconds, capAppliedSeconds };
}

/**
 * @typedef {Object} SettlementAllocationLine
 * @property {'manual_grant'|'gift'|'combo'|'wallet'} source
 * @property {number} seconds
 * @property {number} hours
 * @property {number|null} [grantId]
 * @property {number|null} [inventoryId]
 * @property {string|null} [subscriptionId]
 * @property {number} [walletVnd]
 * @property {number} [pricePerHour]
 */

/**
 * Pure allocation — manual grant → gift → combo → hourly wallet.
 * @param {{
 *   chargeSeconds: number;
 *   plans: Record<string, unknown>[];
 *   walletBalance: number;
 *   nowMs?: number;
 * }} input
 * @returns {{
 *   lines: SettlementAllocationLine[];
 *   chargedSeconds: number;
 *   unchargedSeconds: number;
 *   capAppliedSeconds: number|null;
 * }}
 */
export function allocateSettlementCharge(input) {
  const nowMs = input.nowMs ?? Date.now();
  const targetSeconds = Math.max(0, Math.floor(input.chargeSeconds ?? 0));
  let remaining = targetSeconds;

  const ordered = orderPlansForSettlement(input.plans ?? [], nowMs);
  const lines = /** @type {SettlementAllocationLine[]} */ ([]);
  let walletBalance = Number(input.walletBalance ?? 0);

  for (const plan of ordered) {
    if (remaining <= 0) break;

    if (plan.plan_type === 'hourly') {
      const pricePerHour = Number(plan.price_per_hour ?? 0);
      if (pricePerHour <= 0 || walletBalance <= 0) continue;

      const maxHoursFromWallet = walletBalance / pricePerHour;
      const needHours = remaining / 3600;
      const useHours = Math.min(maxHoursFromWallet, needHours);
      const useSeconds = Math.floor(useHours * 3600);
      if (useSeconds <= 0) continue;

      const walletVnd = Math.round(useHours * pricePerHour);
      lines.push({
        source: 'wallet',
        seconds: useSeconds,
        hours: roundHours(useSeconds / 3600),
        inventoryId: plan.id != null ? Number(plan.id) : null,
        walletVnd,
        pricePerHour,
      });

      walletBalance -= walletVnd;
      remaining -= useSeconds;
      continue;
    }

    const availableHours = Number(plan.hours_remaining ?? 0);
    if (availableHours <= 0) continue;

    const needHours = remaining / 3600;
    const useHours = Math.min(availableHours, needHours);
    const useSeconds = Math.floor(useHours * 3600);
    if (useSeconds <= 0) continue;

    const hasGrant = plan.grant_id != null && plan.grant_id !== '';
    lines.push({
      source: hasGrant ? 'manual_grant' : plan.plan_type === 'combo' ? 'combo' : 'gift',
      seconds: useSeconds,
      hours: roundHours(useSeconds / 3600),
      grantId: hasGrant ? Number(plan.grant_id) : null,
      inventoryId: plan.id != null ? Number(plan.id) : null,
      subscriptionId: plan.subscription_id ? String(plan.subscription_id) : null,
    });

    plan.hours_remaining = roundHours(availableHours - useHours);
    remaining -= useSeconds;
  }

  const chargedSeconds = targetSeconds - remaining;
  return {
    lines,
    chargedSeconds,
    unchargedSeconds: remaining,
    capAppliedSeconds: null,
  };
}

/**
 * @param {{
 *   billableSeconds: number;
 *   chargeSeconds: number;
 *   unchargedSeconds: number;
 *   capAppliedSeconds?: number|null;
 *   lines: SettlementAllocationLine[];
 *   sessionId?: string|null;
 * }} input
 * @returns {Record<string, unknown>}
 */
export function buildSettlementBreakdown(input) {
  /** @type {Record<string, number>} */
  const manualGrantById = {};
  let giftHours = 0;
  let comboHours = 0;
  /** @type {number|null} */
  let comboInventoryId = null;
  let walletVnd = 0;
  let walletHours = 0;

  for (const line of input.lines ?? []) {
    if (line.source === 'manual_grant' && line.grantId != null) {
      manualGrantById[line.grantId] = roundHours(
        (manualGrantById[line.grantId] ?? 0) + line.hours,
      );
    } else if (line.source === 'gift') {
      giftHours = roundHours(giftHours + line.hours);
    } else if (line.source === 'combo') {
      comboHours = roundHours(comboHours + line.hours);
      if (comboInventoryId == null && line.inventoryId != null) {
        comboInventoryId = line.inventoryId;
      }
    } else if (line.source === 'wallet') {
      walletVnd += Number(line.walletVnd ?? 0);
      walletHours = roundHours(walletHours + line.hours);
    }
  }

  const manualGrantHours = roundHours(
    Object.values(manualGrantById).reduce((sum, h) => sum + h, 0),
  );

  return {
    session_id: input.sessionId ?? null,
    billable_seconds: Math.max(0, Math.floor(input.billableSeconds ?? 0)),
    charged_seconds: Math.max(0, Math.floor(input.chargeSeconds ?? 0)),
    uncharged_seconds: Math.max(0, Math.floor(input.unchargedSeconds ?? 0)),
    manual_grant: {
      hours: manualGrantHours,
      grant_ids: Object.keys(manualGrantById).map((id) => Number(id)),
    },
    gift: { hours: giftHours },
    combo: { hours: comboHours, inventory_id: comboInventoryId },
    wallet: { vnd: walletVnd, hours_equivalent: walletHours > 0 ? walletHours : null },
    bonus: null,
    promotion: null,
    cap_applied_seconds: input.capAppliedSeconds ?? null,
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} session
 * @param {{ providerDestroyedVerified?: boolean }} [options]
 * @returns {{ ok: true } | { ok: false; code: string; message: string }}
 */
export function evaluateSettlementEligibility(session, options = {}) {
  if (!session) {
    return {
      ok: false,
      code: SETTLEMENT_ERROR_CODE.SESSION_NOT_FOUND,
      message: 'Session not found',
    };
  }

  const status = String(session.status ?? '');
  if (!CLOSED_SESSION_STATUSES.includes(status)) {
    return {
      ok: false,
      code: SETTLEMENT_ERROR_CODE.SESSION_NOT_CLOSED,
      message: 'Settlement requires closed session',
    };
  }

  if (!session.ended_at) {
    return {
      ok: false,
      code: SETTLEMENT_ERROR_CODE.ENDED_AT_MISSING,
      message: 'Settlement requires ended_at',
    };
  }

  const destroyedVerified =
    options.providerDestroyedVerified === true || Boolean(session.verified_destroyed_at);
  if (!destroyedVerified) {
    return {
      ok: false,
      code: SETTLEMENT_ERROR_CODE.VERIFY_NOT_DESTROYED,
      message: 'Settlement blocked until provider verify DESTROYED (OP-1)',
    };
  }

  const settlementStatus = session.settlement_status ?? null;
  if (settlementStatus === 'settled') {
    return {
      ok: false,
      code: SETTLEMENT_ERROR_CODE.ALREADY_SETTLED,
      message: 'Settlement already committed',
    };
  }
  if (settlementStatus === 'skipped') {
    return {
      ok: false,
      code: SETTLEMENT_ERROR_CODE.ALREADY_SKIPPED,
      message: 'Settlement already skipped',
    };
  }

  return { ok: true };
}

/**
 * @param {Record<string, unknown>|null|undefined} session
 * @returns {boolean}
 */
export function isSettlementIdempotentTerminal(session) {
  const status = session?.settlement_status ?? null;
  return status === 'settled' || status === 'skipped';
}
