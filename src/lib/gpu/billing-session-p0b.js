/**
 * P0-B Billing MVP — pure helpers (no DB/HTTP).
 *
 * Freeze:
 *   billing_started_at ← RUNTIME_READY_FOR_BILLING (once)
 *   close_requested_at ← User/Policy Close
 *   billable = close − started (started null → 0)
 *   Runtime DEAD ≠ settle / ≠ close Billing Session
 */

import { isEndpointResolved } from '../endpoint-utils.js';
import { isProjectionTrafficReady } from '../scb-read-path.js';
import { calculateSessionBillableSeconds } from './remaining-time.js';

/** Sole event allowed to set billable start (`gpu_sessions.started_at`). */
export const RUNTIME_READY_FOR_BILLING = 'RUNTIME_READY_FOR_BILLING';

/**
 * Health + Workspace attachable (= Ready for billing).
 * Does NOT start billing by itself — caller must emit RUNTIME_READY_FOR_BILLING once.
 *
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {{ providerRunningVerified?: boolean }} [opts]
 * @returns {boolean}
 */
export function isRuntimeReadyForBilling(machine, opts = {}) {
  if (!machine || String(machine.status ?? '') !== 'running') return false;
  if (opts.providerRunningVerified !== true) return false;
  // Workspace/Comfy usable: projection traffic ready OR published endpoint for attach.
  return isProjectionTrafficReady(machine) || isEndpointResolved(machine);
}

/**
 * @param {string|Date|null|undefined} billingStartedAt
 * @param {string|Date|null|undefined} closeRequestedAt
 * @returns {number}
 */
export function calculateBillableSecondsFromClose(billingStartedAt, closeRequestedAt) {
  if (billingStartedAt == null || billingStartedAt === '') return 0;
  if (closeRequestedAt == null || closeRequestedAt === '') return 0;
  return calculateSessionBillableSeconds(billingStartedAt, closeRequestedAt);
}

/**
 * Runtime DEAD must keep Billing Session OPEN when already billable.
 * @param {{ status?: string|null; started_at?: string|null }|null|undefined} session
 * @returns {boolean} true = do NOT destroy/settle; keep session open
 */
export function shouldKeepBillingSessionOpenOnRuntimeDead(session) {
  if (!session) return false;
  if (String(session.status ?? '') !== 'running') return false;
  return session.started_at != null && String(session.started_at).trim() !== '';
}

/**
 * Settlement may proceed after billing Close without waiting for provider destroy.
 * @param {Record<string, unknown>|null|undefined} session
 * @param {{ providerDestroyedVerified?: boolean; billingCloseVerified?: boolean }} [options]
 * @returns {boolean}
 */
export function isBillingCloseSettlementAllowed(session, options = {}) {
  if (options.billingCloseVerified === true) return true;
  if (options.providerDestroyedVerified === true) return true;
  if (session?.close_requested_at) return true;
  if (session?.verified_destroyed_at) return true;
  return false;
}
