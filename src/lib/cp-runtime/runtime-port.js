/**
 * Runtime Port — stable Control Plane ↔ Runtime Engine contract (B1.4).
 * Spec: docs/architecture/RuntimePort.md
 *
 * Control Plane must call only these methods. Comfy dialect lives in the
 * Comfy Adapter (1.5), which implements this port.
 */

/** @typedef {'ephemeral' | 'warm' | 'standby'} RuntimePolicyMode */

/**
 * @typedef {object} RuntimePortCreateParams
 * @property {string} userId
 * @property {string} attemptId
 * @property {string} jobId
 * @property {string} requiredImageSpecRef
 * @property {string} [gpuLine]
 * @property {string} [runtimeId]
 * @property {{ mode?: RuntimePolicyMode }} [policy]
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {object} RuntimePortCreateResult
 * @property {string} runtimeId
 * @property {string | null} [endpointUrl]
 * @property {string} imageSpecRef
 * @property {'ready' | 'provisioning' | 'starting'} status
 * @property {string | null} [machineId]
 * @property {string | null} [provider]
 */

/**
 * @typedef {object} RuntimePortSubmitParams
 * @property {string} runtimeId
 * @property {string} jobId
 * @property {string} attemptId
 * @property {Record<string, unknown>} workflowSnapshot
 * @property {object} inputManifest
 * @property {string} imageSpecRef
 * @property {string} [clientId]
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {object} RuntimePortSubmitResult
 * @property {string} externalExecutionId
 * @property {'queued' | 'running'} status
 */

/**
 * @typedef {object} RuntimePortMonitorParams
 * @property {string} runtimeId
 * @property {string} attemptId
 * @property {string} externalExecutionId
 */

/**
 * @typedef {object} RuntimePortMonitorResult
 * @property {'queued' | 'running' | 'succeeded' | 'failed' | 'lost'} status
 * @property {Record<string, unknown>} [progress]
 * @property {string | null} [errorMessage]
 */

/**
 * @typedef {object} RuntimePortFetchParams
 * @property {string} runtimeId
 * @property {string} jobId
 * @property {string} attemptId
 * @property {string} userId
 * @property {string} externalExecutionId
 * @property {object} [outputManifestHints]
 */

/**
 * @typedef {object} RuntimePortFetchResult
 * @property {object} outputManifest
 * @property {string[]} [assetIds]
 */

/**
 * @typedef {object} RuntimePortDestroyParams
 * @property {string} runtimeId
 * @property {string | null} [attemptId]
 * @property {string} [reason]
 * @property {boolean} [releaseCompute]
 */

/**
 * @typedef {object} RuntimePortDestroyResult
 * @property {string} runtimeId
 * @property {'stopping' | 'destroyed'} status
 */

/**
 * @typedef {object} RuntimePort
 * @property {(params: RuntimePortCreateParams) => Promise<RuntimePortCreateResult>} create
 * @property {(params: RuntimePortSubmitParams) => Promise<RuntimePortSubmitResult>} submit
 * @property {(params: RuntimePortMonitorParams) => Promise<RuntimePortMonitorResult>} monitor
 * @property {(params: RuntimePortFetchParams) => Promise<RuntimePortFetchResult>} fetch
 * @property {(params: RuntimePortDestroyParams) => Promise<RuntimePortDestroyResult>} destroy
 */

export const RUNTIME_PORT_METHODS = Object.freeze([
  'create',
  'submit',
  'monitor',
  'fetch',
  'destroy',
]);

export const RUNTIME_PORT_ERROR_CODES = Object.freeze([
  'NOT_IMPLEMENTED',
  'INVALID_ARGUMENT',
  'UNKNOWN_RUNTIME',
  'RUNTIME_NOT_READY',
  'PARITY_FAILED',
  'SUBMIT_REJECTED',
  'EXECUTION_FAILED',
  'EXECUTION_LOST',
  'FETCH_FAILED',
  'DESTROY_FAILED',
  'TIMEOUT',
  'UNAVAILABLE',
]);

export class RuntimePortError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ retryable?: boolean; cause?: unknown; details?: Record<string, unknown> }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'RuntimePortError';
    this.code = String(code || 'UNAVAILABLE');
    this.retryable = Boolean(options.retryable);
    this.details = options.details ?? {};
  }
}

/**
 * @param {unknown} port
 * @returns {asserts port is RuntimePort}
 */
export function assertRuntimePort(port) {
  if (!port || typeof port !== 'object') {
    throw new RuntimePortError('INVALID_ARGUMENT', 'RuntimePort must be an object');
  }
  for (const method of RUNTIME_PORT_METHODS) {
    if (typeof /** @type {Record<string, unknown>} */ (port)[method] !== 'function') {
      throw new RuntimePortError(
        'INVALID_ARGUMENT',
        `RuntimePort missing method: ${method}`,
      );
    }
  }
}

/**
 * Stub Port — every method throws NOT_IMPLEMENTED.
 * Control Plane wiring can depend on this until Comfy Adapter (1.5) lands.
 * @returns {RuntimePort}
 */
export function createUnimplementedRuntimePort() {
  /** @type {RuntimePort} */
  const port = {
    async create() {
      throw new RuntimePortError('NOT_IMPLEMENTED', 'RuntimePort.create not implemented');
    },
    async submit() {
      throw new RuntimePortError('NOT_IMPLEMENTED', 'RuntimePort.submit not implemented');
    },
    async monitor() {
      throw new RuntimePortError('NOT_IMPLEMENTED', 'RuntimePort.monitor not implemented');
    },
    async fetch() {
      throw new RuntimePortError('NOT_IMPLEMENTED', 'RuntimePort.fetch not implemented');
    },
    async destroy() {
      throw new RuntimePortError('NOT_IMPLEMENTED', 'RuntimePort.destroy not implemented');
    },
  };
  return port;
}

/**
 * Test double: records calls; optional per-method handlers.
 *
 * @param {Partial<{
 *   create: RuntimePort['create'];
 *   submit: RuntimePort['submit'];
 *   monitor: RuntimePort['monitor'];
 *   fetch: RuntimePort['fetch'];
 *   destroy: RuntimePort['destroy'];
 * }>} [handlers]
 * @returns {RuntimePort & { calls: Array<{ method: string; params: unknown }> }}
 */
export function createRecordingRuntimePort(handlers = {}) {
  /** @type {Array<{ method: string; params: unknown }>} */
  const calls = [];

  /**
   * @template {keyof RuntimePort} M
   * @param {M} method
   * @param {Parameters<RuntimePort[M]>[0]} params
   */
  async function invoke(method, params) {
    calls.push({ method, params });
    const handler = handlers[method];
    if (typeof handler === 'function') {
      return handler(/** @type {any} */ (params));
    }
    throw new RuntimePortError('NOT_IMPLEMENTED', `RuntimePort.${method} not implemented`);
  }

  const port = {
    calls,
    create: (params) => invoke('create', params),
    submit: (params) => invoke('submit', params),
    monitor: (params) => invoke('monitor', params),
    fetch: (params) => invoke('fetch', params),
    destroy: (params) => invoke('destroy', params),
  };
  assertRuntimePort(port);
  return port;
}

/**
 * Validate minimal required fields for create (CP / Adapter shared guard).
 * @param {RuntimePortCreateParams} params
 */
export function validateCreateParams(params) {
  const missing = [];
  if (!String(params?.userId ?? '').trim()) missing.push('userId');
  if (!String(params?.attemptId ?? '').trim()) missing.push('attemptId');
  if (!String(params?.jobId ?? '').trim()) missing.push('jobId');
  if (!String(params?.requiredImageSpecRef ?? '').trim()) missing.push('requiredImageSpecRef');
  if (missing.length) {
    throw new RuntimePortError(
      'INVALID_ARGUMENT',
      `create missing: ${missing.join(', ')}`,
      { details: { missing } },
    );
  }
}

/**
 * @param {RuntimePortSubmitParams} params
 */
export function validateSubmitParams(params) {
  const missing = [];
  if (!String(params?.runtimeId ?? '').trim()) missing.push('runtimeId');
  if (!String(params?.jobId ?? '').trim()) missing.push('jobId');
  if (!String(params?.attemptId ?? '').trim()) missing.push('attemptId');
  if (!String(params?.imageSpecRef ?? '').trim()) missing.push('imageSpecRef');
  if (!params?.workflowSnapshot || typeof params.workflowSnapshot !== 'object') {
    missing.push('workflowSnapshot');
  }
  if (missing.length) {
    throw new RuntimePortError(
      'INVALID_ARGUMENT',
      `submit missing: ${missing.join(', ')}`,
      { details: { missing } },
    );
  }
}
