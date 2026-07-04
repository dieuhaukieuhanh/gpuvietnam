/** Pure helpers for provisioning/status-poll race (no Supabase / GPU imports). */

export const STALE_BOOT_MS = 15 * 60 * 1000;

/**
 * @param {Record<string, unknown>} machine
 */
export function isMachineBooting(machine) {
  const status = String(machine.status ?? 'creating');
  return status === 'creating' || status === 'starting';
}

/**
 * @param {Record<string, unknown>} machine
 * @param {number} [nowMs]
 */
export function isRecentBootMachine(machine, nowMs = Date.now()) {
  const createdAt = machine.created_at ? new Date(String(machine.created_at)).getTime() : 0;
  if (createdAt <= 0) return true;
  return nowMs - createdAt < STALE_BOOT_MS;
}

/**
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {string|undefined|null} subscriptionServerStatus
 * @param {number} [nowMs]
 */
export function shouldRepairBootingSubscriptionDrift(
  machine,
  subscriptionServerStatus,
  nowMs = Date.now(),
) {
  if (!machine || subscriptionServerStatus !== 'offline') return false;
  if (!isMachineBooting(machine)) return false;
  return isRecentBootMachine(machine, nowMs);
}

/**
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {string|undefined|null} subscriptionServerStatus
 */
export function shouldResetIdleProvisioningSubscription(machine, subscriptionServerStatus) {
  if (machine) return false;
  if (subscriptionServerStatus !== 'provisioning') return false;
  return false;
}

/**
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {string} errorMessage
 * @param {number} [nowMs]
 */
export function shouldSkipDeadInstanceDestroyDuringBoot(machine, errorMessage, nowMs = Date.now()) {
  if (!machine || !isMachineBooting(machine) || !isRecentBootMachine(machine, nowMs)) {
    return false;
  }
  return /not found|404|does not exist|invalid instance/i.test(errorMessage);
}
