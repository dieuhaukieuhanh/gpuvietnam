/**
 * Session Resume state machine (dashboard restore + safe start).
 */

export const RESUME_STATE = {
  OFFLINE: 'OFFLINE',
  RESUMING: 'RESUMING',
  PROVISIONING: 'PROVISIONING',
  BOOTING: 'BOOTING',
  STARTING_COMFY: 'STARTING_COMFY',
  RUNNING: 'RUNNING',
  STOPPING: 'STOPPING',
  ERROR: 'ERROR',
};

/** Map resume state → existing machineSessionView.phase */
export const RESUME_STATE_TO_PHASE = {
  OFFLINE: 'idle',
  RESUMING: 'opening',
  PROVISIONING: 'opening',
  BOOTING: 'opening',
  STARTING_COMFY: 'opening',
  RUNNING: 'running',
  STOPPING: 'stopping',
  ERROR: 'error',
};

/**
 * @param {string} resumeState
 * @returns {string}
 */
export function progressStepForResumeState(resumeState) {
  switch (resumeState) {
    case RESUME_STATE.PROVISIONING:
      return 'provisioning';
    case RESUME_STATE.BOOTING:
      return 'booting';
    case RESUME_STATE.STARTING_COMFY:
      return 'starting_comfy';
    case RESUME_STATE.RUNNING:
      return 'ready';
    case RESUME_STATE.STOPPING:
      return 'stopping';
    case RESUME_STATE.ERROR:
      return 'error';
    case RESUME_STATE.RESUMING:
      return 'resuming';
    default:
      return 'offline';
  }
}