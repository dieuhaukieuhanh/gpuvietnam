/**
 * SCB 2.1 Phase 3 — Provider capability model.
 * Scheduler (future) reads capabilities from registry — no hardcoded provider facts.
 */

/** @typedef {'second' | 'minute' | 'hourly' | 'session'} BillingGranularity */

/** @typedef {'spot_hourly' | 'reserved_hourly' | 'session_flat' | 'internal'} PricingModel */

/** @typedef {'low' | 'medium' | 'high'} StartupLatency */

/**
 * @typedef {Object} ProviderCapabilities
 * @property {boolean} supportsSpot
 * @property {boolean} supportsReserved
 * @property {boolean} supportsDocker
 * @property {StartupLatency} startupLatency
 * @property {BillingGranularity} billingGranularity
 * @property {readonly string[]} gpuTypes
 * @property {readonly string[]} regions
 * @property {string|null} maxDuration
 * @property {PricingModel} pricingModel
 * @property {boolean} implemented
 */

/** @type {ProviderCapabilities} */
export const STUB_PROVIDER_CAPABILITIES = {
  supportsSpot: false,
  supportsReserved: false,
  supportsDocker: true,
  startupLatency: 'medium',
  billingGranularity: 'hourly',
  gpuTypes: [],
  regions: [],
  maxDuration: null,
  pricingModel: 'spot_hourly',
  implemented: false,
};

/**
 * @param {Partial<ProviderCapabilities>} overrides
 * @returns {ProviderCapabilities}
 */
export function defineProviderCapabilities(overrides) {
  return {
    ...STUB_PROVIDER_CAPABILITIES,
    ...overrides,
    gpuTypes: overrides.gpuTypes ? [...overrides.gpuTypes] : [],
    regions: overrides.regions ? [...overrides.regions] : [],
  };
}

/** Marketplace providers registered in the orchestration layer. */
export const MARKETPLACE_PROVIDER_IDS = Object.freeze(['clore', 'vast', 'salad', 'runpod']);

export const CLORE_CAPABILITIES = defineProviderCapabilities({
  supportsSpot: true,
  supportsReserved: false,
  supportsDocker: true,
  startupLatency: 'medium',
  billingGranularity: 'hourly',
  gpuTypes: ['rtx3090', 'rtx4090_1x', 'rtx5090_1x', 'rtx4090_2x'],
  regions: ['global'],
  maxDuration: null,
  pricingModel: 'spot_hourly',
  implemented: true,
});

export const VAST_CAPABILITIES = defineProviderCapabilities({
  supportsSpot: true,
  supportsReserved: false,
  supportsDocker: true,
  startupLatency: 'medium',
  billingGranularity: 'hourly',
  gpuTypes: ['rtx3090', 'rtx4090_1x', 'rtx5090_1x', 'rtx4090_2x'],
  regions: [], // populated at runtime via listRegions()
  maxDuration: '3d',
  pricingModel: 'spot_hourly',
  implemented: true,
});

export const SALAD_CAPABILITIES = defineProviderCapabilities({
  supportsSpot: true,
  supportsDocker: true,
  startupLatency: 'low',
  billingGranularity: 'hourly',
  gpuTypes: ['rtx3090', 'rtx4090_1x', 'rtx5090_1x', 'rtx4090_2x'],
  regions: [],
  pricingModel: 'spot_hourly',
  implemented: false,
});

export const RUNPOD_CAPABILITIES = defineProviderCapabilities({
  supportsSpot: true,
  supportsReserved: true,
  supportsDocker: true,
  startupLatency: 'medium',
  billingGranularity: 'hourly',
  gpuTypes: ['rtx3090', 'rtx4090_1x', 'rtx5090_1x', 'rtx4090_2x'],
  regions: [],
  pricingModel: 'spot_hourly',
  implemented: false,
});
