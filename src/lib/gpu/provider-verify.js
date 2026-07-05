/**
 * Provider Verification Module — M4.
 * Gate RUNNING (session start) and DESTROYED (pre-settlement) via GPU Provider Adapter only.
 * No Supabase, billing, settlement, or direct Vast HTTP.
 * @see docs/SESSION_CENTRIC_BILLING_ARCHITECTURE.md §7
 * @see docs/IMPLEMENTATION_PLAN_SCB.md M4
 */

import {
  GPUInstanceNotFoundError,
  GPUProviderError,
  isRetryableGpuError,
} from './gpu-errors.js';
import {
  detectMachineDrifts,
  detectSessionDrifts,
  detectSettlementDrifts,
} from '../infrastructure/reconciliation-core.js';

/** @typedef {import('./domain/gpu-instance').GPUInstance} GPUInstance */
/** @typedef {import('./domain/gpu-status').GPUStatus} GPUStatus */
/** @typedef {import('./domain/gpu-status').GPUStatusCode} GPUStatusCode */

/**
 * Minimal provider port for verification — adapter boundary (ADR-007).
 * @typedef {Object} ProviderVerifyPort
 * @property {(instanceId: string) => Promise<GPUInstance>} getInstanceStatus
 * @property {(instanceId: string) => Promise<GPUStatus>} [healthCheck]
 */

/**
 * @typedef {'running'|'destroyed'|'starting'|'stopping'|'stopped'|'failed'|'unknown'} NormalizedProviderState
 */

/**
 * @typedef {Object} ProviderStateSnapshot
 * @property {string} instanceId
 * @property {NormalizedProviderState} normalizedState
 * @property {GPUStatusCode} [rawStatusCode]
 * @property {boolean} [healthHealthy]
 * @property {string} [message]
 * @property {string} checkedAt
 */

/**
 * @typedef {Object} ProviderVerifyOk
 * @property {'OK'} state
 * @property {string} outcome
 * @property {ProviderStateSnapshot} snapshot
 * @property {string} verifiedAt
 */

/**
 * @typedef {Object} ProviderVerifyFailed
 * @property {'FAILED'} state
 * @property {string} outcome
 * @property {ProviderStateSnapshot|null} snapshot
 * @property {string} code
 * @property {string} message
 * @property {boolean} [retryable]
 */

/**
 * @typedef {Object} ProviderVerifyUnknown
 * @property {'UNKNOWN'} state
 * @property {string} outcome
 * @property {ProviderStateSnapshot|null} snapshot
 * @property {string} code
 * @property {string} message
 * @property {boolean} [retryable]
 */

/** @typedef {ProviderVerifyOk | ProviderVerifyFailed | ProviderVerifyUnknown} ProviderVerifyResult */

/**
 * @typedef {Object} ReconciliationDriftDescriptor
 * @property {string} driftType
 * @property {string} entityType
 * @property {string} entityId
 * @property {string} message
 * @property {Record<string, unknown>} [details]
 */

/**
 * @typedef {Object} ReconciliationResult
 * @property {'OK'} state
 * @property {ReconciliationDriftDescriptor[]} drifts
 * @property {string} message
 */

export const PROVIDER_VERIFY_MODULE_VERSION = '1.0';

export const NORMALIZED_PROVIDER_STATE = Object.freeze({
  RUNNING: 'running',
  DESTROYED: 'destroyed',
  STARTING: 'starting',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
});

export const PROVIDER_VERIFY_STATE = Object.freeze({
  OK: 'OK',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
});

export const PROVIDER_VERIFY_OUTCOME = Object.freeze({
  VERIFIED_RUNNING: 'verified_running',
  VERIFIED_DESTROYED: 'verified_destroyed',
  VERIFY_FAILED: 'verify_failed',
  UNKNOWN: 'unknown',
});

export const PROVIDER_VERIFY_ERROR_CODE = Object.freeze({
  INSTANCE_NOT_FOUND: 'INSTANCE_NOT_FOUND',
  INSTANCE_STILL_RUNNING: 'INSTANCE_STILL_RUNNING',
  INSTANCE_NOT_READY: 'INSTANCE_NOT_READY',
  HEALTH_CHECK_FAILED: 'HEALTH_CHECK_FAILED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  INVALID_INSTANCE_ID: 'INVALID_INSTANCE_ID',
});

/** @param {string} [now] @returns {string} */
function verifyNow(now) {
  return now ?? new Date().toISOString();
}

/**
 * Map GPU status code to normalized provider state (pure).
 * @param {GPUStatusCode|string|undefined|null} code
 * @returns {NormalizedProviderState}
 */
export function normalizeGpuStatusCode(code) {
  const value = String(code ?? 'unknown').toLowerCase();
  if (value === 'running') {
    return NORMALIZED_PROVIDER_STATE.RUNNING;
  }
  if (value === 'starting' || value === 'pending') {
    return NORMALIZED_PROVIDER_STATE.STARTING;
  }
  if (value === 'stopping') {
    return NORMALIZED_PROVIDER_STATE.STOPPING;
  }
  if (value === 'stopped') {
    return NORMALIZED_PROVIDER_STATE.DESTROYED;
  }
  if (value === 'failed') {
    return NORMALIZED_PROVIDER_STATE.FAILED;
  }
  if (value === 'unknown') {
    return NORMALIZED_PROVIDER_STATE.UNKNOWN;
  }
  return NORMALIZED_PROVIDER_STATE.UNKNOWN;
}

/**
 * @param {string} instanceId
 * @param {GPUInstance|null|undefined} instance
 * @param {{ health?: GPUStatus|null, message?: string, checkedAt?: string }} [options]
 * @returns {ProviderStateSnapshot}
 */
export function buildProviderStateSnapshot(instanceId, instance, options = {}) {
  const rawStatusCode = instance?.status?.code;
  const normalizedState = instance
    ? normalizeGpuStatusCode(rawStatusCode)
    : NORMALIZED_PROVIDER_STATE.UNKNOWN;

  return {
    instanceId,
    normalizedState,
    rawStatusCode,
    healthHealthy: options.health?.healthy,
    message: options.message ?? instance?.status?.message,
    checkedAt: options.checkedAt ?? verifyNow(),
  };
}

/**
 * Pure evaluation — RUNNING verify gate (SCB §7.2).
 * @param {ProviderStateSnapshot} snapshot
 * @returns {ProviderVerifyResult}
 */
export function evaluateRunningVerify(snapshot) {
  if (snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.RUNNING) {
    if (snapshot.healthHealthy === false) {
      return {
        state: PROVIDER_VERIFY_STATE.FAILED,
        outcome: PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED,
        snapshot,
        code: PROVIDER_VERIFY_ERROR_CODE.HEALTH_CHECK_FAILED,
        message: 'Instance running but health check not healthy',
        retryable: true,
      };
    }
    if (snapshot.healthHealthy === true) {
      return {
        state: PROVIDER_VERIFY_STATE.OK,
        outcome: PROVIDER_VERIFY_OUTCOME.VERIFIED_RUNNING,
        snapshot,
        verifiedAt: snapshot.checkedAt,
      };
    }

    return {
      state: PROVIDER_VERIFY_STATE.FAILED,
      outcome: PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED,
      snapshot,
      code:
        snapshot.healthHealthy === false
          ? PROVIDER_VERIFY_ERROR_CODE.HEALTH_CHECK_FAILED
          : PROVIDER_VERIFY_ERROR_CODE.INSTANCE_NOT_READY,
      message:
        snapshot.healthHealthy === false
          ? 'Instance running but health check not healthy'
          : 'ComfyUI health check required before billable session',
      retryable: true,
    };
  }

  if (
    snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.STARTING ||
    snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.STOPPING ||
    snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.UNKNOWN
  ) {
    return {
      state: PROVIDER_VERIFY_STATE.FAILED,
      outcome: PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED,
      snapshot,
      code: PROVIDER_VERIFY_ERROR_CODE.INSTANCE_NOT_READY,
      message: `Instance not ready: ${snapshot.normalizedState}`,
      retryable: true,
    };
  }

  if (
    snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.DESTROYED ||
    snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.STOPPED ||
    snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.FAILED
  ) {
    return {
      state: PROVIDER_VERIFY_STATE.FAILED,
      outcome: PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED,
      snapshot,
      code: PROVIDER_VERIFY_ERROR_CODE.INSTANCE_NOT_FOUND,
      message: 'Instance not running',
      retryable: false,
    };
  }

  return {
    state: PROVIDER_VERIFY_STATE.FAILED,
    outcome: PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED,
    snapshot,
    code: PROVIDER_VERIFY_ERROR_CODE.INSTANCE_NOT_READY,
    message: `Unexpected provider state: ${snapshot.normalizedState}`,
    retryable: true,
  };
}

/**
 * Pure evaluation — DESTROYED verify gate (SCB §7.2, OP-1).
 * @param {ProviderStateSnapshot} snapshot
 * @returns {ProviderVerifyResult}
 */
export function evaluateDestroyedVerify(snapshot) {
  if (
    snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.DESTROYED ||
    snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.STOPPED ||
    snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.FAILED
  ) {
    return {
      state: PROVIDER_VERIFY_STATE.OK,
      outcome: PROVIDER_VERIFY_OUTCOME.VERIFIED_DESTROYED,
      snapshot,
      verifiedAt: snapshot.checkedAt,
    };
  }

  if (snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.RUNNING) {
    return {
      state: PROVIDER_VERIFY_STATE.FAILED,
      outcome: PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED,
      snapshot,
      code: PROVIDER_VERIFY_ERROR_CODE.INSTANCE_STILL_RUNNING,
      message: 'Instance still running — settlement blocked (OP-1)',
      retryable: true,
    };
  }

  if (
    snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.STARTING ||
    snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.STOPPING
  ) {
    return {
      state: PROVIDER_VERIFY_STATE.FAILED,
      outcome: PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED,
      snapshot,
      code: PROVIDER_VERIFY_ERROR_CODE.INSTANCE_NOT_READY,
      message: `Instance not destroyed: ${snapshot.normalizedState}`,
      retryable: true,
    };
  }

  return {
    state: PROVIDER_VERIFY_STATE.UNKNOWN,
    outcome: PROVIDER_VERIFY_OUTCOME.UNKNOWN,
    snapshot,
    code: PROVIDER_VERIFY_ERROR_CODE.PROVIDER_ERROR,
    message: `Cannot confirm destroyed: ${snapshot.normalizedState}`,
    retryable: true,
  };
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isProviderVerifyTimeoutError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|502|503|504/i.test(message);
}

/**
 * @param {string} instanceId
 * @param {unknown} error
 * @param {string} [now]
 * @returns {ProviderVerifyUnknown}
 */
export function buildUnknownVerifyResult(instanceId, error, now) {
  const checkedAt = verifyNow(now);
  const retryable =
    isProviderVerifyTimeoutError(error) ||
    (error instanceof GPUProviderError && isRetryableGpuError(error));

  return {
    state: PROVIDER_VERIFY_STATE.UNKNOWN,
    outcome: PROVIDER_VERIFY_OUTCOME.UNKNOWN,
    snapshot: {
      instanceId,
      normalizedState: NORMALIZED_PROVIDER_STATE.UNKNOWN,
      message: error instanceof Error ? error.message : String(error),
      checkedAt,
    },
    code: isProviderVerifyTimeoutError(error)
      ? PROVIDER_VERIFY_ERROR_CODE.PROVIDER_TIMEOUT
      : PROVIDER_VERIFY_ERROR_CODE.PROVIDER_ERROR,
    message: error instanceof Error ? error.message : String(error),
    retryable,
  };
}

/**
 * @param {string} instanceId
 * @param {ProviderVerifyPort} port
 * @param {{ now?: string, requireHealthCheck?: boolean }} [options]
 * @returns {Promise<ProviderStateSnapshot>}
 */
export async function readProviderStateSnapshot(instanceId, port, options = {}) {
  const checkedAt = verifyNow(options.now);
  const trimmedId = String(instanceId ?? '').trim();

  if (!trimmedId) {
    throw new Error(PROVIDER_VERIFY_ERROR_CODE.INVALID_INSTANCE_ID);
  }

  try {
    const instance = await port.getInstanceStatus(trimmedId);
    let health = null;

    if (port.healthCheck && normalizeGpuStatusCode(instance.status?.code) === NORMALIZED_PROVIDER_STATE.RUNNING) {
      try {
        health = await port.healthCheck(trimmedId);
      } catch (healthError) {
        if (isProviderVerifyTimeoutError(healthError)) {
          return buildProviderStateSnapshot(trimmedId, instance, {
            health: { code: 'unknown', healthy: false, checkedAt },
            message: healthError instanceof Error ? healthError.message : String(healthError),
            checkedAt,
          });
        }
        return buildProviderStateSnapshot(trimmedId, instance, {
          health: { code: 'unknown', healthy: false, checkedAt },
          message: healthError instanceof Error ? healthError.message : String(healthError),
          checkedAt,
        });
      }
    }

    return buildProviderStateSnapshot(trimmedId, instance, {
      health,
      checkedAt,
    });
  } catch (error) {
    if (error instanceof GPUInstanceNotFoundError) {
      return {
        instanceId: trimmedId,
        normalizedState: NORMALIZED_PROVIDER_STATE.DESTROYED,
        rawStatusCode: 'stopped',
        message: error.message,
        checkedAt,
      };
    }

    if (/not found|\b404\b/i.test(error instanceof Error ? error.message : String(error))) {
      return {
        instanceId: trimmedId,
        normalizedState: NORMALIZED_PROVIDER_STATE.DESTROYED,
        rawStatusCode: 'stopped',
        message: error instanceof Error ? error.message : String(error),
        checkedAt,
      };
    }

    throw error;
  }
}

/**
 * Read live provider state — normalized, no DB writes (M4 / M13 contract).
 * @param {string} instanceId
 * @param {ProviderVerifyPort} port
 * @param {{ now?: string }} [options]
 * @returns {Promise<ProviderVerifyResult>}
 */
export async function verifyProviderState(instanceId, port, options = {}) {
  const trimmedId = String(instanceId ?? '').trim();
  if (!trimmedId) {
    return {
      state: PROVIDER_VERIFY_STATE.FAILED,
      outcome: PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED,
      snapshot: null,
      code: PROVIDER_VERIFY_ERROR_CODE.INVALID_INSTANCE_ID,
      message: 'instanceId is required',
      retryable: false,
    };
  }

  try {
    const snapshot = await readProviderStateSnapshot(trimmedId, port, options);
    /** @type {string} */
    let outcome = PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED;
    if (snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.DESTROYED) {
      outcome = PROVIDER_VERIFY_OUTCOME.VERIFIED_DESTROYED;
    } else if (snapshot.normalizedState === NORMALIZED_PROVIDER_STATE.RUNNING) {
      outcome = PROVIDER_VERIFY_OUTCOME.VERIFIED_RUNNING;
    }

    return {
      state: PROVIDER_VERIFY_STATE.OK,
      outcome,
      snapshot,
      verifiedAt: snapshot.checkedAt,
    };
  } catch (error) {
    return buildUnknownVerifyResult(trimmedId, error, options.now);
  }
}

/**
 * Verify instance RUNNING — session pending → running gate.
 * @param {string} instanceId
 * @param {ProviderVerifyPort} port
 * @param {{ now?: string }} [options]
 * @returns {Promise<ProviderVerifyResult>}
 */
export async function verifyInstanceRunning(instanceId, port, options = {}) {
  const trimmedId = String(instanceId ?? '').trim();
  if (!trimmedId) {
    return {
      state: PROVIDER_VERIFY_STATE.FAILED,
      outcome: PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED,
      snapshot: null,
      code: PROVIDER_VERIFY_ERROR_CODE.INVALID_INSTANCE_ID,
      message: 'instanceId is required',
      retryable: false,
    };
  }

  try {
    const snapshot = await readProviderStateSnapshot(trimmedId, port, options);
    return evaluateRunningVerify(snapshot);
  } catch (error) {
    return buildUnknownVerifyResult(trimmedId, error, options.now);
  }
}

/**
 * Verify instance DESTROYED — pre-settlement gate (OP-1, ADR-003).
 * @param {string} instanceId
 * @param {ProviderVerifyPort} port
 * @param {{ now?: string }} [options]
 * @returns {Promise<ProviderVerifyResult>}
 */
export async function verifyInstanceDestroyed(instanceId, port, options = {}) {
  const trimmedId = String(instanceId ?? '').trim();
  if (!trimmedId) {
    return {
      state: PROVIDER_VERIFY_STATE.FAILED,
      outcome: PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED,
      snapshot: null,
      code: PROVIDER_VERIFY_ERROR_CODE.INVALID_INSTANCE_ID,
      message: 'instanceId is required',
      retryable: false,
    };
  }

  try {
    const snapshot = await readProviderStateSnapshot(trimmedId, port, options);
    return evaluateDestroyedVerify(snapshot);
  } catch (error) {
    return buildUnknownVerifyResult(trimmedId, error, options.now);
  }
}

/**
 * Wrap GPUService as ProviderVerifyPort — integration boundary for M7/M9.
 * @param {{ getInstanceStatus: (id: string) => Promise<GPUInstance>, healthCheck?: (id: string) => Promise<GPUStatus> }} gpuService
 * @returns {ProviderVerifyPort}
 */
export function createProviderVerifyPortFromGpuService(gpuService) {
  return {
    getInstanceStatus: (instanceId) => gpuService.getInstanceStatus(instanceId),
    healthCheck: gpuService.healthCheck
      ? (instanceId) => gpuService.healthCheck(instanceId)
      : undefined,
  };
}

/**
 * M13 — reconcile machine row vs provider (detection only).
 * @param {Record<string, unknown>} input
 */
export function reconcileMachine(input = {}) {
  const drifts = detectMachineDrifts(input);
  return {
    state: 'OK',
    drifts,
    message: drifts.length > 0 ? 'drift detected' : 'consistent',
  };
}

/**
 * M13 — reconcile session vs machine/provider (detection only).
 * @param {Record<string, unknown>} input
 */
export function reconcileSession(input = {}) {
  const drifts = detectSessionDrifts(input);
  return {
    state: 'OK',
    drifts,
    message: drifts.length > 0 ? 'drift detected' : 'consistent',
  };
}

/**
 * M13 — detect settlement drift (no settlement trigger).
 * @param {Record<string, unknown>} input
 */
export function reconcileSettlement(input = {}) {
  const drifts = detectSettlementDrifts(input);
  return {
    state: 'OK',
    drifts,
    message: drifts.length > 0 ? 'drift detected' : 'consistent',
  };
}

/**
 * Idempotent pass check for verify results.
 * @param {ProviderVerifyResult} result
 * @param {'running'|'destroyed'} verifyType
 * @returns {boolean}
 */
export function isVerifyPass(result, verifyType) {
  if (result.state !== PROVIDER_VERIFY_STATE.OK) {
    return false;
  }
  if (verifyType === 'running') {
    return result.outcome === PROVIDER_VERIFY_OUTCOME.VERIFIED_RUNNING;
  }
  return result.outcome === PROVIDER_VERIFY_OUTCOME.VERIFIED_DESTROYED;
}
