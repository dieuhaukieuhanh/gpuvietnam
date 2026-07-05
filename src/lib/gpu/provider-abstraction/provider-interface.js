/**
 * SCB 2.1 Phase 3 — Unified Provider Adapter interface.
 * Provider adapters do NOT know Scheduler, Queue, or SCB lifecycle.
 */

/** @typedef {import('./provider-capabilities.js').ProviderCapabilities} ProviderCapabilities */

/**
 * @typedef {Object} ProviderInfo
 * @property {string} id
 * @property {string} name
 * @property {string} version
 */

/**
 * @typedef {Object} CreateMachineParams
 * @property {import('../domain/gpu-instance').GPULine} gpuLine
 * @property {string} [region]
 * @property {string} [plan]
 * @property {string} [image]
 * @property {string} [label]
 * @property {Record<string, string>} [env]
 * @property {number} [diskSize]
 * @property {number} [port]
 */

/**
 * @typedef {Object} ListOffersParams
 * @property {import('../domain/gpu-instance').GPULine} gpuLine
 * @property {string} [plan]
 * @property {string} [region]
 * @property {number} [limit]
 */

/**
 * @typedef {Object} ProviderOffer
 * @property {string|number} offerId
 * @property {string} region
 * @property {number} pricePerHour
 * @property {string} gpuType
 * @property {number} [score]
 * @property {string} [reason]
 */

/**
 * @typedef {Object} ProviderRegion
 * @property {string} id
 * @property {string} label
 * @property {number} [score]
 */

/**
 * @typedef {Object} ProviderHealthResult
 * @property {boolean} healthy
 * @property {string} [message]
 * @property {string} checkedAt
 */

/**
 * @typedef {Object} VerifyRunningResult
 * @property {boolean} running
 * @property {string} [normalizedState]
 * @property {string} [message]
 * @property {string} checkedAt
 */

/**
 * @typedef {Object} ProviderAdapter
 * @property {() => ProviderInfo} getInfo
 * @property {() => ProviderCapabilities} getCapabilities
 * @property {(params: CreateMachineParams) => Promise<import('../domain/gpu-instance').GPUInstance>} createMachine
 * @property {(instanceId: string) => Promise<void>} destroyMachine
 * @property {(instanceId: string) => Promise<import('../domain/gpu-instance').GPUInstance>} getMachine
 * @property {(params: ListOffersParams) => Promise<ProviderOffer[]>} listOffers
 * @property {() => Promise<ProviderRegion[]>} listRegions
 * @property {(instanceId?: string) => Promise<ProviderHealthResult>} health
 * @property {(instanceId: string, options?: Record<string, unknown>) => Promise<VerifyRunningResult>} verifyRunning
 */

export const PROVIDER_ADAPTER_METHODS = [
  'getInfo',
  'getCapabilities',
  'createMachine',
  'destroyMachine',
  'getMachine',
  'listOffers',
  'listRegions',
  'health',
  'verifyRunning',
];

/**
 * @param {unknown} adapter
 * @returns {adapter is ProviderAdapter}
 */
export function isProviderAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') return false;
  return PROVIDER_ADAPTER_METHODS.every(
    (method) => typeof /** @type {Record<string, unknown>} */ (adapter)[method] === 'function',
  );
}
