/**
 * Pure Session Resume decision logic (no I/O).
 */

import { RESUME_STATE, progressStepForResumeState } from './session-resume-states.js';

/**
 * @typedef {{
 *   serverStatus?: string | null;
 *   leaseExpired?: boolean;
 *   hasActiveLease?: boolean;
 *   machine?: {
 *     id?: string | null;
 *     status?: string | null;
 *     instance_id?: string | null;
 *     provider?: string | null;
 *     provider_id?: string | null;
 *   } | null;
 *   liveStatus?: string | null;
 *   healthOk?: boolean;
 *   sessionStatus?: string | null;
 *   machineLifecycleStatus?: string | null;
 * }} SessionResumeInput
 */

/**
 * Decide whether an existing session/machine/lease must be resumed
 * instead of starting a new provision.
 *
 * @param {SessionResumeInput} input
 */
export function decideSessionResume(input = {}) {
  const serverStatus = String(input.serverStatus ?? 'offline').toLowerCase();
  const machine = input.machine && typeof input.machine === 'object' ? input.machine : null;
  const live = String(input.liveStatus ?? '').toLowerCase();
  const healthOk = input.healthOk === true;
  const sessionStatus = String(input.sessionStatus ?? '').toLowerCase();
  const lifecycle = String(input.machineLifecycleStatus ?? machine?.status ?? '').toLowerCase();
  const leaseExpired = input.leaseExpired === true;
  const hasActiveLease = input.hasActiveLease === true;

  /** @type {{ currentState: string; shouldResume: boolean; allowNewProvision: boolean; reason: string; progressStep: string; duplicateStartPrevented: boolean }} */
  let decision;

  if (lifecycle === 'stopping' || serverStatus === 'stopping') {
    decision = base(RESUME_STATE.STOPPING, true, false, 'machine_stopping');
  } else if (lifecycle === 'error' || live === 'error' || live === 'failed') {
    // Show ERROR in UI, but never block "Thử lại" / new provision.
    // Stuck error machines must be recoverable by start (which destroys leaked rows).
    decision = base(RESUME_STATE.ERROR, true, true, 'machine_error');
  } else if ((serverStatus === 'online' || lifecycle === 'running') && machine) {
    if (healthOk || live === 'running') {
      decision = base(RESUME_STATE.RUNNING, true, false, 'already_running');
    } else if (live === 'starting' || live === 'creating' || !live) {
      decision = base(RESUME_STATE.STARTING_COMFY, true, false, 'comfy_not_ready_yet');
    } else {
      decision = base(RESUME_STATE.STARTING_COMFY, true, false, 'online_waiting_comfy');
    }
  } else if (serverStatus === 'provisioning' || hasActiveLease) {
    if (leaseExpired && !machine) {
      // Expired lease with no machine: start-machine may reclaim — not a silent resume.
      decision = base(RESUME_STATE.OFFLINE, false, true, 'lease_expired_reclaim_allowed');
    } else if (machine && (live === 'starting' || live === 'creating' || lifecycle === 'creating' || lifecycle === 'starting')) {
      decision = base(RESUME_STATE.BOOTING, true, false, 'provisioning_machine_booting');
    } else if (machine && (live === 'running' || healthOk)) {
      decision = base(RESUME_STATE.STARTING_COMFY, true, false, 'provisioning_awaiting_comfy');
    } else if (machine) {
      decision = base(RESUME_STATE.BOOTING, true, false, 'provisioning_with_machine');
    } else if (sessionStatus === 'pending' || sessionStatus === 'running') {
      decision = base(RESUME_STATE.PROVISIONING, true, false, 'pending_gpu_session');
    } else {
      decision = base(RESUME_STATE.PROVISIONING, true, false, 'active_provision_lease');
    }
  } else if (machine && (live === 'starting' || live === 'creating' || isBootingStatus(lifecycle))) {
    decision = base(RESUME_STATE.BOOTING, true, false, 'machine_booting');
  } else if (sessionStatus === 'pending' || sessionStatus === 'running') {
    // Open session with no live machine = ghost after replace/stop. Do not block Start.
    if (!machine || lifecycle === 'destroyed') {
      decision = base(RESUME_STATE.OFFLINE, false, true, 'ghost_session_reprovision');
    } else {
      decision = base(RESUME_STATE.PROVISIONING, true, false, 'reconnectable_session');
    }
  } else if (machine && !leaseExpired) {
    decision = base(RESUME_STATE.BOOTING, true, false, 'existing_machine_row');
  } else {
    decision = base(RESUME_STATE.OFFLINE, false, true, 'offline_idle');
  }

  decision.progressStep = progressStepForResumeState(decision.currentState);
  decision.duplicateStartPrevented = decision.shouldResume && !decision.allowNewProvision;
  return decision;
}

/**
 * @param {string} status
 */
function isBootingStatus(status) {
  return /creating|starting|provisioning|pending|booting/i.test(String(status ?? ''));
}

/**
 * @param {string} currentState
 * @param {boolean} shouldResume
 * @param {boolean} allowNewProvision
 * @param {string} reason
 */
function base(currentState, shouldResume, allowNewProvision, reason) {
  return {
    currentState,
    shouldResume,
    allowNewProvision,
    reason,
    progressStep: progressStepForResumeState(currentState),
    duplicateStartPrevented: shouldResume && !allowNewProvision,
  };
}