/**
 * Read-only projection from M2 Remaining breakdown to billing status fields (M5).
 * Pure module — no Supabase, no tick billing.
 */

import { REMAINING_STATE_OK } from './remaining-time.js';

/**
 * @param {import('./remaining-time.js').RemainingResult} remainingResult
 * @param {number|null} walletBalance
 */
export function mapRemainingResultToBillingCredit(remainingResult, walletBalance) {
  if (remainingResult.state !== REMAINING_STATE_OK) {
    return {
      hoursRemaining: null,
      effectiveHoursRemaining: null,
      planType: null,
      walletBalance: walletBalance != null ? Number(walletBalance) : null,
    };
  }

  return {
    hoursRemaining: remainingResult.totalEntitlementHours,
    effectiveHoursRemaining: remainingResult.remainingHours,
    planType: remainingResult.primaryPlanType,
    walletBalance: walletBalance != null ? Number(walletBalance) : null,
  };
}

/**
 * Project M2 OK result to scalar remaining hours (M10 consumers).
 * @param {import('./remaining-time.js').RemainingResult | null | undefined} remainingResult
 * @returns {number | null}
 */
export function resolveScbRemainingHours(remainingResult) {
  if (!remainingResult || remainingResult.state !== REMAINING_STATE_OK) {
    return null;
  }
  return remainingResult.remainingHours;
}
