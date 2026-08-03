/**
 * SCB 2.1 Phase 3 — Provider abstraction bootstrap and exports.
 */

import { VastProviderAdapter } from '../providers/vast/vast-provider-adapter.js';
import { CloreProviderAdapter } from '../providers/clore/clore-provider-adapter.js';
import { SaladProviderAdapter } from '../providers/salad/salad-provider-adapter.js';
import { createRunpodProviderAdapter } from '../providers/runpod/runpod-provider-adapter.js';
import { attachWorkflowDelegate, createLegacyGpuProviderBridge } from './legacy-gpu-provider-bridge.js';
import {
  getDefaultProviderAdapter,
  getDefaultProviderId,
  getProviderAdapter,
  tryGetProviderAdapter,
  listRegisteredProviders,
  registerProviderAdapter,
  resetProviderRegistryForTests,
  setDefaultProviderAdapter,
} from './provider-registry.js';
import { MARKETPLACE_PROVIDER_IDS } from './provider-capabilities.js';

/** @type {boolean} */
let bootstrapped = false;

export function bootstrapProviderRegistry() {
  if (bootstrapped) return;
  bootstrapped = true;

  const vastAdapter = new VastProviderAdapter();
  attachWorkflowDelegate(vastAdapter, vastAdapter.legacyProvider);
  registerProviderAdapter(vastAdapter);

  const cloreAdapter = new CloreProviderAdapter();
  registerProviderAdapter(cloreAdapter);
  registerProviderAdapter(new SaladProviderAdapter());
  registerProviderAdapter(createRunpodProviderAdapter());
}

/**
 * @returns {import('./provider-interface.js').ProviderAdapter}
 */
export function resolveDefaultProviderAdapter() {
  bootstrapProviderRegistry();
  return getDefaultProviderAdapter();
}

/**
 * @returns {import('../providers/gpu-provider.interface').GPUProvider}
 */
export function createDefaultLegacyGpuProvider() {
  return createLegacyGpuProviderBridge(resolveDefaultProviderAdapter());
}

export {
  attachWorkflowDelegate,
  createLegacyGpuProviderBridge,
  getDefaultProviderAdapter,
  getDefaultProviderId,
  getProviderAdapter,
  tryGetProviderAdapter,
  listRegisteredProviders,
  registerProviderAdapter,
  resetProviderRegistryForTests,
  setDefaultProviderAdapter,
  MARKETPLACE_PROVIDER_IDS,
};

export { isProviderAdapter, PROVIDER_ADAPTER_METHODS } from './provider-interface.js';
export { defineProviderCapabilities } from './provider-capabilities.js';
export {
  cancelOrphanBeforeNextHost,
  walkRentCandidates,
} from '../rent-candidate-walk.js';
