/**
 * Pure SCB 2.1 Phase 1 helpers — no machines/gpu imports (testable without path aliases).
 */

/** @typedef {'update_subscription' | 'mark_destroyed_local' | 'destroy_user_machine' | 'destroy_and_subscription_offline'} DriftRepairKind */

/**
 * @typedef {Object} DriftRepairSpec
 * @property {DriftRepairKind} kind
 * @property {string} [subscriptionId]
 * @property {'online' | 'offline' | 'provisioning'} [serverStatus]
 * @property {Record<string, unknown>} [machine]
 * @property {{ skipBackup?: boolean; interrupted?: boolean; skipBilling?: boolean; skipMetrics?: boolean; reason?: string }} [destroyOptions]
 */

/**
 * @typedef {Object} DriftDetectResult
 * @property {boolean} changed
 * @property {Record<string, unknown>|null} machine
 * @property {Record<string, unknown>|null} subscription
 * @property {string|null} action
 * @property {DriftRepairSpec|null} repair
 */

/**
 * @param {boolean} changed
 * @param {Record<string, unknown>|null} machine
 * @param {Record<string, unknown>|null} subscription
 * @param {string|null} action
 * @param {DriftRepairSpec|null} repair
 * @returns {DriftDetectResult}
 */
export function buildDetectResult(changed, machine, subscription, action, repair) {
  return { changed, machine, subscription, action, repair };
}

/**
 * Phase 1 default ON. Set SCB21_READ_PATH_DETECT_ONLY=0 to rollback read paths to inline sync repair.
 */
export function isScb21ReadPathDetectOnly() {
  return process.env.SCB21_READ_PATH_DETECT_ONLY !== '0';
}

/**
 * Detect provision failure cleanup (machines/status error branch).
 *
 * @param {Record<string, unknown>} machine
 * @param {{ status?: string; message?: string | null }} liveStatus
 * @returns {DriftDetectResult|null}
 */
export function detectProvisionFailureDrift(machine, liveStatus) {
  if (liveStatus.status !== 'error') return null;

  /** @type {DriftRepairSpec} */
  const repair = {
    kind: 'destroy_and_subscription_offline',
    destroyOptions: {
      skipBackup: true,
      interrupted: true,
      skipBilling: true,
      skipMetrics: true,
      reason: 'provision_failed',
    },
  };

  if (machine.subscription_id) {
    repair.subscriptionId = String(machine.subscription_id);
  }

  return buildDetectResult(
    true,
    null,
    machine.subscription_id ? { server_status: 'offline' } : null,
    'provision_failed_destroy',
    repair,
  );
}

/**
 * @param {DriftDetectResult} detectResult
 * @returns {{ changed: boolean; machine: Record<string, unknown>|null; subscription: Record<string, unknown>|null; action: string|null }}
 */
export function toSyncShape(detectResult) {
  return {
    changed: detectResult.changed,
    machine: detectResult.machine,
    subscription: detectResult.subscription,
    action: detectResult.action,
  };
}
