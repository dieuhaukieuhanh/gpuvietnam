/**
 * Unified Destroy Pipeline — pure helpers (M7).
 * Orchestration step mapping only; no DB or HTTP.
 */

import {
  PROVIDER_VERIFY_STATE,
  PROVIDER_VERIFY_OUTCOME,
  isVerifyPass,
} from './gpu/provider-verify.js';

export const DESTROY_PIPELINE_VERSION = '1.0';

export const DESTROY_PIPELINE_STEP = Object.freeze({
  RESOLVE: 'resolve',
  BACKUP: 'backup',
  SESSION_CLOSING: 'session_closing',
  PROVIDER_DESTROY: 'provider_destroy',
  VERIFY_DESTROYED: 'verify_destroyed',
  SESSION_CLOSED: 'session_closed',
  SETTLEMENT: 'settlement',
  CLEANUP: 'cleanup',
  COMPLETE: 'complete',
});

export const DESTROY_PIPELINE_OUTCOME = Object.freeze({
  DESTROYED: 'destroyed',
  NO_MACHINE: 'no_machine',
  PENDING_VERIFY: 'pending_verify',
  VERIFY_FAILED: 'verify_failed',
  ROLLED_BACK: 'rolled_back',
  PROVIDER_DESTROY_FAILED: 'provider_destroy_failed',
  SETTLEMENT_FAILED: 'settlement_failed',
  ALREADY_DESTROYED: 'already_destroyed',
  /** Interactive stop: backup did not complete — do not destroy yet; UI offers force/wait. */
  BACKUP_FAILED: 'backup_failed',
});

/**
 * @typedef {'destroyed'|'still_running'|'unknown'|'failed'} DestroyVerifyOutcome
 */

/**
 * @param {import('./gpu/provider-verify.js').ProviderVerifyResult} verifyResult
 * @returns {DestroyVerifyOutcome}
 */
export function mapDestroyedVerifyOutcome(verifyResult) {
  if (isVerifyPass(verifyResult, 'destroyed')) {
    return 'destroyed';
  }
  if (verifyResult.state === PROVIDER_VERIFY_STATE.UNKNOWN) {
    return 'unknown';
  }
  if (verifyResult.state === PROVIDER_VERIFY_STATE.FAILED) {
    const state = verifyResult.snapshot?.normalizedState;
    if (state === 'running' || state === 'starting') {
      return 'still_running';
    }
    if (verifyResult.outcome === PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED) {
      return 'failed';
    }
    return 'failed';
  }
  return 'failed';
}

/**
 * @param {DestroyVerifyOutcome} outcome
 * @returns {boolean}
 */
export function isDestroyVerifyRetryable(outcome) {
  return outcome === 'unknown';
}

/**
 * @param {Record<string, unknown>|null|undefined} sessionRow
 * @returns {boolean}
 */
export function isSessionReadyForSettlement(sessionRow) {
  const status = String(sessionRow?.status ?? '');
  return status === 'closed' || status === 'completed';
}

/**
 * @param {Record<string, unknown>|null|undefined} sessionRow
 * @returns {boolean}
 */
export function isSessionTerminalSettled(sessionRow) {
  const settlementStatus = sessionRow?.settlement_status;
  return settlementStatus === 'settled' || settlementStatus === 'skipped';
}

/**
 * @param {string|null|undefined} destroyReason
 * @returns {string}
 */
export function normalizePipelineDestroyReason(destroyReason) {
  const reason = String(destroyReason ?? '').trim();
  if (
    reason === 'user_stop' ||
    reason === 'admin_stop' ||
    reason === 'idle_timeout' ||
    reason === 'out_of_credit'
  ) {
    return reason;
  }
  return 'user_stop';
}

/**
 * @param {Record<string, unknown>|null|undefined} machine
 * @returns {boolean}
 */
export function shouldRunBackup(machine, options = {}) {
  if (options.skipBackup) return false;
  if (!options.reason) return false;
  return String(machine?.status ?? '') === 'running';
}

/**
 * @param {Record<string, unknown>|null|undefined} machine
 * @returns {boolean}
 */
export function machineHasBillableSession(machine) {
  return Boolean(machine?.gpu_session_id && machine?.billing_started_at);
}

/** @type {number} */
export const SESSION_DESTROY_MACHINE_TOLERANCE_MS = 5000;

/**
 * Whether a linked session row is the active billable session for destroy (M7 hotfix).
 * Read-only gate — does not change billing anchor or settlement rules.
 *
 * @param {Record<string, unknown>|null|undefined} session
 * @param {Record<string, unknown>|null|undefined} machine
 * @returns {boolean}
 */
export function sessionBelongsToMachineForDestroy(session, machine) {
  if (!session?.started_at || !machine?.created_at) return false;
  const sessionStart = new Date(String(session.started_at)).getTime();
  const machineCreated = new Date(String(machine.created_at)).getTime();
  if (!Number.isFinite(sessionStart) || !Number.isFinite(machineCreated)) return false;
  return sessionStart >= machineCreated - SESSION_DESTROY_MACHINE_TOLERANCE_MS;
}

/**
 * @param {Record<string, unknown>|null|undefined} session
 * @param {Record<string, unknown>|null|undefined} machine
 * @returns {boolean}
 */
export function isProvenDestroySession(session, machine) {
  if (!session || !machine) return false;

  const status = String(session.status ?? '');
  if (status !== 'running' && status !== 'closing') return false;
  if (status === 'running' && !session.started_at) return false;

  if (machine.id && session.machine_id && String(session.machine_id) !== String(machine.id)) {
    return false;
  }

  return sessionBelongsToMachineForDestroy(session, machine);
}

/**
 * Legacy helper (pre-P0-B): settlement after destroy verify.
 * Prefer {@link assertSettlementAtBillingClose} for P0-B.
 * @param {string[]} stepTrace
 * @returns {boolean}
 */
export function assertSettlementAfterVerify(stepTrace) {
  const verifyIdx = stepTrace.indexOf(DESTROY_PIPELINE_STEP.VERIFY_DESTROYED);
  const settleIdx = stepTrace.indexOf(DESTROY_PIPELINE_STEP.SETTLEMENT);
  if (settleIdx === -1) return true;
  if (verifyIdx === -1) return false;
  return verifyIdx < settleIdx;
}

/** P0-B: settlement step must occur before destroy verify when both present. */
export function assertSettlementAtBillingClose(stepTrace) {
  const verifyIdx = stepTrace.indexOf(DESTROY_PIPELINE_STEP.VERIFY_DESTROYED);
  const settleIdx = stepTrace.indexOf(DESTROY_PIPELINE_STEP.SETTLEMENT);
  if (settleIdx === -1) return true;
  if (verifyIdx === -1) return true;
  return settleIdx < verifyIdx;
}
