/**
 * API response mapping for SCB (M9) — orchestration only, no business rules.
 */

import { REMAINING_STATE_OK } from './remaining-time.js';

/**
 * @param {Record<string, unknown> | null | undefined} sessionRow
 */
export function mapSessionStatusFields(sessionRow) {
  if (!sessionRow) {
    return {
      sessionStatus: null,
      settlementStatus: null,
      verifiedRunningAt: null,
      verifiedDestroyedAt: null,
    };
  }

  return {
    sessionStatus: sessionRow.status != null ? String(sessionRow.status) : null,
    settlementStatus:
      sessionRow.settlement_status != null ? String(sessionRow.settlement_status) : null,
    verifiedRunningAt: sessionRow.verified_running_at ?? null,
    verifiedDestroyedAt: sessionRow.verified_destroyed_at ?? null,
  };
}

/**
 * @param {{ remaining?: import('./remaining-time.js').RemainingResult | null; walletBalance?: number | null }} remainingRead
 */
export function mapRemainingStatusFields(remainingRead) {
  const remaining = remainingRead?.remaining;
  if (!remaining || remaining.state !== REMAINING_STATE_OK) {
    return {
      remainingHours: null,
      totalEntitlementHours: null,
      currentSessionElapsedHours: null,
      settledSessionUsageHours: null,
    };
  }

  return {
    remainingHours: remaining.remainingHours,
    totalEntitlementHours: remaining.totalEntitlementHours,
    currentSessionElapsedHours: remaining.currentSessionElapsedHours,
    settledSessionUsageHours: remaining.settledSessionUsageHours,
  };
}

/**
 * @param {{
 *   destroyed?: boolean;
 *   backupSuccess?: boolean | null;
 *   reason?: string;
 *   billingResult?: { durationSeconds?: number; hoursUsed?: number } | null;
 *   metrics?: { outputCount?: number } | null;
 *   settlementStatus?: string | null;
 *   verifiedDestroyedAt?: string | null;
 *   verifyStatus?: string | null;
 *   verify?: { state?: string } | null;
 * }} result
 */
export function mapDestroyApiResponse(result) {
  const verifyStatus =
    result.verifyStatus ?? result.verify?.state ?? null;
  const billableSeconds = Number(result.billingResult?.durationSeconds ?? 0);

  return {
    success: Boolean(result.destroyed),
    backupSuccess: result.backupSuccess ?? null,
    reason: result.reason ?? null,
    settlementStatus: result.settlementStatus ?? null,
    verifiedDestroyedAt: result.verifiedDestroyedAt ?? null,
    verifyStatus,
    billableSeconds,
    session: {
      durationSeconds: billableSeconds,
      hoursUsed: result.billingResult?.hoursUsed ?? 0,
      outputCount: result.metrics?.outputCount ?? 0,
    },
  };
}
