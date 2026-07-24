/**
 * SCB 2.1 Phase 2 — Machine Operation Queue pure helpers (no Supabase imports).
 */

/** @typedef {'drift_update_subscription' | 'drift_mark_destroyed_local' | 'drift_destroy_user_machine' | 'drift_destroy_and_subscription_offline' | 'projection_verify' | 'user_start_provision' | 'runtime_auto_replace'} MachineOperationType */

/** @typedef {'pending' | 'leased' | 'running' | 'completed' | 'failed' | 'cancelled' | 'retry_scheduled' | 'dead_letter'} MachineOperationState */

export const MACHINE_OPERATION = {
  DRIFT_UPDATE_SUBSCRIPTION: 'drift_update_subscription',
  DRIFT_MARK_DESTROYED_LOCAL: 'drift_mark_destroyed_local',
  DRIFT_DESTROY_USER_MACHINE: 'drift_destroy_user_machine',
  DRIFT_DESTROY_AND_SUBSCRIPTION_OFFLINE: 'drift_destroy_and_subscription_offline',
  PROJECTION_VERIFY: 'projection_verify',
  USER_START_PROVISION: 'user_start_provision',
  RUNTIME_AUTO_REPLACE: 'runtime_auto_replace',
};

export const MACHINE_OPERATION_STATE = {
  PENDING: 'pending',
  LEASED: 'leased',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RETRY_SCHEDULED: 'retry_scheduled',
  DEAD_LETTER: 'dead_letter',
};

export const DEFAULT_RETRY_POLICY = 'default_drift';

/** @type {Record<string, MachineOperationType>} */
export const REPAIR_KIND_TO_OPERATION = {
  update_subscription: MACHINE_OPERATION.DRIFT_UPDATE_SUBSCRIPTION,
  mark_destroyed_local: MACHINE_OPERATION.DRIFT_MARK_DESTROYED_LOCAL,
  destroy_user_machine: MACHINE_OPERATION.DRIFT_DESTROY_USER_MACHINE,
  destroy_and_subscription_offline: MACHINE_OPERATION.DRIFT_DESTROY_AND_SUBSCRIPTION_OFFLINE,
};

export {
  priorityForOperation,
  hasExhaustedRetryPolicy as hasExhaustedAttempts,
  getRetryPolicy,
  resolveRetryAfterFailure,
  resolveProviderFromMachine,
  MACHINE_OPERATION_RETRY_POLICIES,
  PRIORITY_CLASS,
} from './machine-operation-policies.js';

/**
 * @param {string|null|undefined} repairKind
 * @returns {MachineOperationType|null}
 */
export function repairKindToOperation(repairKind) {
  if (!repairKind) return null;
  return REPAIR_KIND_TO_OPERATION[repairKind] ?? null;
}

/**
 * @param {string} userId
 * @param {string|null|undefined} action
 * @param {{ kind?: string; machine?: Record<string, unknown>|null }} [repair]
 * @returns {string}
 */
export function buildDriftIdempotencyKey(userId, action, repair) {
  const machineId = repair?.machine?.id ? String(repair.machine.id) : 'none';
  const kind = repair?.kind ?? 'unknown';
  const actionPart = action ?? kind;
  return `drift:${userId}:${actionPart}:${machineId}:${kind}`;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
export function isActiveQueueState(row) {
  const state = String(row.state ?? '');
  return (
    state === MACHINE_OPERATION_STATE.PENDING ||
    state === MACHINE_OPERATION_STATE.LEASED ||
    state === MACHINE_OPERATION_STATE.RUNNING ||
    state === MACHINE_OPERATION_STATE.RETRY_SCHEDULED
  );
}

/**
 * @param {Record<string, unknown>} row
 */
export function isTerminalQueueState(row) {
  const state = String(row.state ?? '');
  return (
    state === MACHINE_OPERATION_STATE.COMPLETED ||
    state === MACHINE_OPERATION_STATE.CANCELLED ||
    state === MACHINE_OPERATION_STATE.DEAD_LETTER ||
    state === MACHINE_OPERATION_STATE.FAILED
  );
}

/**
 * @param {string} userId
 * @param {string|null|undefined} machineId
 */
export function projectionVerifyIdempotencyKey(userId, machineId) {
  return `projection_verify:${userId}:${machineId ?? 'none'}`;
}

/**
 * Single open provision slot per user (prevents multi-start / multi-rent).
 * Correlation stays in payload only. Dual-run GPUs use CP dual-run path, not this key.
 * @param {string} userId
 */
export function userStartProvisionIdempotencyKey(userId) {
  return `user_start_provision:open:${userId}`;
}

/**
 * Free the open slot after terminal state so a later start can enqueue again.
 * @param {string} userId
 * @param {string} operationId
 */
export function userStartProvisionReleasedIdempotencyKey(userId, operationId) {
  return `user_start_provision:done:${userId}:${operationId}`;
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
export function isUserStartProvisionOperation(row) {
  return String(row?.operation ?? '') === MACHINE_OPERATION.USER_START_PROVISION;
}

/**
 * When an active projection_verify row exists, return skip reason for scheduler.
 * @param {Record<string, unknown>|null|undefined} existingOperation
 * @returns {'already_pending'|'already_running'|null}
 */
export function projectionVerifySkipReason(existingOperation) {
  if (!existingOperation || !isActiveQueueState(existingOperation)) {
    return null;
  }
  const state = String(existingOperation.state ?? '');
  if (
    state === MACHINE_OPERATION_STATE.RUNNING ||
    state === MACHINE_OPERATION_STATE.LEASED
  ) {
    return 'already_running';
  }
  return 'already_pending';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {{
 *   changed: boolean;
 *   machine: Record<string, unknown>|null;
 *   subscription: Record<string, unknown>|null;
 *   action: string|null;
 *   repair: Record<string, unknown>|null;
 * }}
 */
export function detectResultFromOperationPayload(row) {
  const payload =
    row.payload && typeof row.payload === 'object'
      ? /** @type {Record<string, unknown>} */ (row.payload)
      : {};

  return {
    changed: true,
    machine: /** @type {Record<string, unknown>|null} */ (payload.machine ?? null),
    subscription: /** @type {Record<string, unknown>|null} */ (payload.subscription ?? null),
    action: typeof payload.action === 'string' ? payload.action : null,
    repair: /** @type {Record<string, unknown>|null} */ (payload.repair ?? null),
  };
}

/**
 * True when machine_operations queue infra is not ready in Supabase (migration not applied).
 * Read paths must not fail dashboard/API when queue infra is absent or schema is behind code.
 *
 * @param {unknown} error
 */
export function isMachineOperationsTableUnavailable(error) {
  if (!error || typeof error !== 'object') return false;
  const record = /** @type {{ code?: string; message?: string }} */ (error);
  const code = String(record.code ?? '');
  const message = String(record.message ?? error ?? '');

  if (code === '23514' && /machine_operations_operation_check/i.test(message)) {
    return true;
  }

  if (!/machine_operations/i.test(message) && code !== 'PGRST205') {
    return false;
  }

  if (code === 'PGRST205') return true;
  if (code === '42P01' || code === '42703') return true;

  return /schema cache|Could not find the table|does not exist|relation .* does not exist/i.test(
    message,
  );
}
