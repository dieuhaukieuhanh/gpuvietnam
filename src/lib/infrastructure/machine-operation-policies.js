/**
 * SCB 2.1 Phase 2.5 — Central retry + priority policies for machine_operations.
 * Worker and scheduler read from here only — no magic numbers in queue code.
 */

/** @typedef {'default_drift' | 'user_start_provision' | 'runtime_auto_replace'} MachineOperationRetryPolicyName */

/**
 * @typedef {Object} MachineOperationRetryPolicy
 * @property {MachineOperationRetryPolicyName|string} name
 * @property {number} maxAttempts
 * @property {readonly number[]} delaysMs
 */

/** Priority class registry — higher number = higher priority. */
export const PRIORITY_CLASS = {
  DESTROY: 100,
  RECOVER: 90,
  REPAIR: 80,
  PROVISION: 70,
  PROBE: 60,
};

/** Worker lease duration while executing one operation. */
export const LEASE_DURATION_MS = 90_000;

/** Longer lease for durable provision (heartbeat extends while running). */
export const PROVISION_LEASE_MS = 10 * 60_000;

/** Running row older than this without completion is treated as orphan. */
export const RUNNING_ORPHAN_MS = LEASE_DURATION_MS * 2;

/** Pending row older than this without lease progress is re-armed for the worker. */
export const PENDING_STALE_MS = 2 * 60 * 1000;

/**
 * Central retry policies.
 * Attempt N failure schedules delay delaysMs[N-1] before next retry.
 * Attempt maxAttempts → dead letter.
 */
export const MACHINE_OPERATION_RETRY_POLICIES = {
  default_drift: {
    name: 'default_drift',
    maxAttempts: 5,
    delaysMs: [5_000, 20_000, 60_000, 300_000],
  },
  /** Fewer retries — partial Clore rent relies on recoverRentedInstance / orphan reconcile. */
  user_start_provision: {
    name: 'user_start_provision',
    maxAttempts: 3,
    delaysMs: [60_000, 300_000],
  },
  /** P1: replace dead Runtime; keep Billing Session OPEN. */
  runtime_auto_replace: {
    name: 'runtime_auto_replace',
    maxAttempts: 3,
    delaysMs: [60_000, 180_000],
  },
};

/** @type {Record<string, keyof typeof PRIORITY_CLASS>} */
export const OPERATION_PRIORITY_CLASS = {
  drift_destroy_user_machine: 'DESTROY',
  drift_destroy_and_subscription_offline: 'DESTROY',
  drift_mark_destroyed_local: 'RECOVER',
  drift_update_subscription: 'REPAIR',
  user_start_provision: 'PROVISION',
  runtime_auto_replace: 'RECOVER',
  projection_verify: 'PROBE',
};

/**
 * @param {string|null|undefined} policyName
 * @returns {MachineOperationRetryPolicy}
 */
export function getRetryPolicy(policyName) {
  const key = policyName && MACHINE_OPERATION_RETRY_POLICIES[policyName]
    ? policyName
    : 'default_drift';
  return MACHINE_OPERATION_RETRY_POLICIES[key];
}

/**
 * @param {string} operationType
 * @returns {number}
 */
export function priorityForOperation(operationType) {
  const classKey = OPERATION_PRIORITY_CLASS[operationType];
  if (classKey && PRIORITY_CLASS[classKey] != null) {
    return PRIORITY_CLASS[classKey];
  }
  return PRIORITY_CLASS.PROBE;
}

/**
 * Resolve retry outcome after a failed attempt.
 *
 * @param {string|null|undefined} policyName
 * @param {number} attemptNumber — attempts after this failure (1-based)
 * @returns {{ deadLetter: true; failureReason: string } | { deadLetter: false; delayMs: number; nextRetryAt: Date }}
 */
export function resolveRetryAfterFailure(policyName, attemptNumber, now = new Date()) {
  const policy = getRetryPolicy(policyName);

  if (attemptNumber >= policy.maxAttempts) {
    return {
      deadLetter: true,
      failureReason: 'max_attempts_exceeded',
    };
  }

  const delayIndex = Math.max(0, attemptNumber - 1);
  const delayMs =
    policy.delaysMs[delayIndex] ?? policy.delaysMs[policy.delaysMs.length - 1] ?? 5_000;

  return {
    deadLetter: false,
    delayMs,
    nextRetryAt: new Date(now.getTime() + delayMs),
  };
}

/**
 * @param {number} attempts
 * @param {string|null|undefined} policyName
 * @returns {boolean}
 */
export function hasExhaustedRetryPolicy(attempts, policyName) {
  return attempts >= getRetryPolicy(policyName).maxAttempts;
}

/**
 * @param {Record<string, unknown>|null|undefined} machine
 * @returns {string}
 */
export function resolveProviderFromMachine(machine) {
  const provider = machine && typeof machine.provider === 'string' ? machine.provider : null;
  if (provider && provider.trim()) return provider.trim();
  // Missing provider: treat as Vast (historical default + current primary).
  return 'vast';
}
