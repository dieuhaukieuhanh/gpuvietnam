/**
 * Auto Stop Decision Engine — pure core (M8).
 * Read-only decisions only. No DB, destroy, billing, or settlement.
 * @see docs/IMPLEMENTATION_PLAN_SCB.md M8
 */

import { isOutOfCredit, REMAINING_STATE_OK } from './remaining-time.js';

export const AUTO_STOP_MODULE_VERSION = '1.0';

export const AUTO_STOP_DECISION = Object.freeze({
  SKIPPED: 'skipped',
  DESTROY: 'destroy',
  WARN: 'warn',
  IDLE: 'idle',
  ACTIVE: 'active',
  ERROR: 'error',
});

/**
 * @param {string|null|undefined} machineStatus
 * @returns {boolean}
 */
export function shouldSkipAutoStop(machineStatus) {
  return String(machineStatus ?? '') !== 'running';
}

/**
 * @param {import('./remaining-time.js').RemainingResult|null|undefined} remaining
 * @param {number|string|null|undefined} walletBalance
 * @param {boolean} machineHasBilling
 * @returns {boolean}
 */
export function shouldStopForOutOfCredit(remaining, walletBalance, machineHasBilling) {
  if (!machineHasBilling) return false;
  if (!remaining || remaining.state !== REMAINING_STATE_OK) return false;
  return isOutOfCredit({ ...remaining, walletBalance });
}

/**
 * @param {number|null|undefined} idleMinutes
 * @param {number} [idleStopMinutes]
 * @returns {boolean}
 */
export function shouldStopForIdle(idleMinutes, idleStopMinutes = 60) {
  return idleMinutes != null && idleMinutes >= idleStopMinutes;
}

/**
 * @param {number|null|undefined} idleMinutes
 * @param {boolean} idleWarningSent
 * @param {number} [warnMinutes]
 * @returns {boolean}
 */
export function shouldWarnForIdle(idleMinutes, idleWarningSent, warnMinutes = 55) {
  return (
    idleMinutes != null && idleMinutes >= warnMinutes && idleWarningSent !== true
  );
}

/**
 * @param {{
 *   machineStatus: string;
 *   machineHasBilling: boolean;
 *   remaining: import('./remaining-time.js').RemainingResult|null;
 *   walletBalance: number|string|null;
 *   hasEndpoint: boolean;
 *   queueReachable: boolean;
 *   hasActiveJobs: boolean;
 *   idleMinutes: number|null;
 *   idleWarningSent: boolean;
 *   idleStopMinutes?: number;
 *   idleWarnMinutes?: number;
 * }} input
 * @returns {{ decision: string; reason?: string; idleMinutes?: number|null }}
 */
export function decideAutoStopAction(input) {
  if (shouldSkipAutoStop(input.machineStatus)) {
    return { decision: AUTO_STOP_DECISION.SKIPPED, reason: 'not_running' };
  }

  if (
    shouldStopForOutOfCredit(
      input.remaining,
      input.walletBalance,
      input.machineHasBilling,
    )
  ) {
    return { decision: AUTO_STOP_DECISION.DESTROY, reason: 'out_of_credit' };
  }

  if (!input.hasEndpoint) {
    return { decision: AUTO_STOP_DECISION.SKIPPED, reason: 'no_endpoint' };
  }

  if (!input.queueReachable) {
    return { decision: AUTO_STOP_DECISION.ERROR, reason: 'queue_unreachable' };
  }

  if (input.hasActiveJobs) {
    return { decision: AUTO_STOP_DECISION.ACTIVE };
  }

  const idleMinutes = input.idleMinutes ?? 0;
  const stopMinutes = input.idleStopMinutes ?? 60;
  const warnMinutes = input.idleWarnMinutes ?? 55;

  if (shouldStopForIdle(idleMinutes, stopMinutes)) {
    return { decision: AUTO_STOP_DECISION.DESTROY, reason: 'idle_timeout', idleMinutes };
  }

  if (shouldWarnForIdle(idleMinutes, input.idleWarningSent, warnMinutes)) {
    return { decision: AUTO_STOP_DECISION.WARN, idleMinutes };
  }

  return { decision: AUTO_STOP_DECISION.IDLE, idleMinutes };
}
