/** Pure helpers for provisioning/status-poll race (no Supabase / GPU imports). */

export const STALE_BOOT_MS = 15 * 60 * 1000;
/** Boot stuck in creating/starting under provisioning (no ComfyUI progress). */
export const STALE_PROVISIONING_BOOT_MS = 3 * 60 * 1000;
/** Max wait for ComfyUI boot before projection read path auto-cleanup (local/slow loads). */
export const PROVISIONING_BOOT_MAX_MS = 30 * 60 * 1000;

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
 * @param {number} [maxAgeMs]
 */
export function isRecentBootMachine(machine, nowMs = Date.now(), maxAgeMs = STALE_BOOT_MS) {
  const createdAt = machine.created_at ? new Date(String(machine.created_at)).getTime() : 0;
  if (createdAt <= 0) return true;
  return nowMs - createdAt < maxAgeMs;
}

/**
 * Booting machine rows that should be torn down (projection read path, no provider I/O).
 *
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {string|undefined|null} subscriptionServerStatus
 * @param {number} [nowMs]
 */
export function shouldCleanupLeakedBootMachine(
  machine,
  subscriptionServerStatus,
  nowMs = Date.now(),
) {
  if (!machine || !isMachineBooting(machine)) return false;
  if (!machine.instance_id) {
    return !isRecentBootMachine(machine, nowMs, PROVISIONING_BOOT_MAX_MS);
  }
  if (subscriptionServerStatus === 'offline') {
    return !isRecentBootMachine(machine, nowMs) || isStaleProvisioningBoot(machine, nowMs);
  }

  if (subscriptionServerStatus === 'provisioning') {
    return !isRecentBootMachine(machine, nowMs, PROVISIONING_BOOT_MAX_MS);
  }

  if (!isRecentBootMachine(machine, nowMs)) return true;
  return false;
}

/**
 * Legacy sync path only — start-machine always sets provisioning before rent.
 * Projection read path uses shouldCleanupLeakedBootMachine instead.
 *
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
 * @param {number} [nowMs]
 * @param {number} [staleMs]
 */
export function isStaleProvisioningBoot(
  machine,
  nowMs = Date.now(),
  staleMs = STALE_PROVISIONING_BOOT_MS,
) {
  if (!machine || !isMachineBooting(machine)) return false;
  const createdMs = machine.created_at ? new Date(String(machine.created_at)).getTime() : 0;
  if (!Number.isFinite(createdMs) || createdMs <= 0) return false;
  return nowMs - createdMs >= staleMs;
}

/**
 * Async start-machine sets provisioning before Vast rent inserts a machine row.
 * Read-path drift must not reset that window (see machine-lifecycle detectDriftRepair).
 *
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {string|undefined|null} subscriptionServerStatus
 */
export function shouldResetIdleProvisioningSubscription(machine, subscriptionServerStatus) {
  void machine;
  void subscriptionServerStatus;
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

/**
 * Stale-boot cleanup should only destroy when the provider reports a hard failure.
 * Booting states (`creating`, `starting`, `disconnected`) are normal while ComfyUI loads.
 *
 * @param {{ status?: string }} liveStatus
 */
export function shouldDestroyStaleBootMachine(liveStatus) {
  return String(liveStatus?.status ?? '') === 'error';
}

/**
 * Whether an in-flight boot should be torn down and re-provisioned (start-machine path).
 *
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {{ status?: string }|null|undefined} liveStatus
 * @param {string|null|undefined} targetEnvName
 * @param {number} [nowMs]
 */
export function shouldRetryProvisioningForBoot(
  machine,
  liveStatus,
  targetEnvName,
  nowMs = Date.now(),
) {
  if (!machine) return true;
  if (!machine.instance_id) return true;
  if (machine.status === 'error') return true;
  if (liveStatus?.status === 'error') return true;
  if (isStaleProvisioningBoot(machine, nowMs)) return true;

  const machineTemplate =
    typeof machine.template === 'string' ? machine.template.trim() : '';
  const target = typeof targetEnvName === 'string' ? targetEnvName.trim() : '';
  if (machineTemplate && target && machineTemplate !== target) return true;

  const createdAt = machine.created_at ? new Date(String(machine.created_at)).getTime() : 0;
  const ageMs = createdAt > 0 ? nowMs - createdAt : 0;
  if (ageMs > PROVISIONING_BOOT_MAX_MS && liveStatus?.status !== 'running') {
    return true;
  }

  return false;
}
