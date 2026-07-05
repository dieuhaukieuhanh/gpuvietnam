/**
 * SCB 2.1 Phase 3 — Provider abstraction bootstrap and exports.
 */

import { VastProviderAdapter } from '../providers/vast/vast-provider-adapter.js';
import { createSaladProviderAdapter } from '../providers/stubs/salad-provider-adapter.js';
import { createTensorDockProviderAdapter } from '../providers/stubs/tensordock-provider-adapter.js';
import { createInterDataProviderAdapter } from '../providers/stubs/interdata-provider-adapter.js';
import { createGpuVietnamInternalProviderAdapter } from '../providers/stubs/gpuvietnam-internal-provider-adapter.js';
import { attachWorkflowDelegate, createLegacyGpuProviderBridge } from './legacy-gpu-provider-bridge.js';
import {
  getDefaultProviderAdapter,
  getDefaultProviderId,
  getProviderAdapter,
  listRegisteredProviders,
  registerProviderAdapter,
  resetProviderRegistryForTests,
  setDefaultProviderAdapter,
} from './provider-registry.js';

/** @type {boolean} */
let bootstrapped = false;

export function bootstrapProviderRegistry() {
  if (bootstrapped) return;
  bootstrapped = true;

  const vastAdapter = new VastProviderAdapter();
  attachWorkflowDelegate(vastAdapter, vastAdapter.legacyProvider);
  registerProviderAdapter(vastAdapter);
  registerProviderAdapter(createSaladProviderAdapter());
  registerProviderAdapter(createTensorDockProviderAdapter());
  registerProviderAdapter(createInterDataProviderAdapter());
  registerProviderAdapter(createGpuVietnamInternalProviderAdapter());
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
  listRegisteredProviders,
  registerProviderAdapter,
  resetProviderRegistryForTests,
  setDefaultProviderAdapter,
};

export { isProviderAdapter, PROVIDER_ADAPTER_METHODS } from './provider-interface.js';
export { defineProviderCapabilities } from './provider-capabilities.js';
