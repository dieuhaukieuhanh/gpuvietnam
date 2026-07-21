/**
 * SCB 2.1 Phase 3 — Provider Registry.
 * Register, lookup, capability, version — no scheduling logic.
 */

import { isProviderAdapter } from './provider-interface.js';

/** @type {Map<string, import('./provider-interface.js').ProviderAdapter>} */
const registry = new Map();

/** @type {import('./provider-interface.js').ProviderAdapter|null} */
let defaultAdapter = null;

/**
 * @param {import('./provider-interface.js').ProviderAdapter} adapter
 */
export function registerProviderAdapter(adapter) {
  if (!isProviderAdapter(adapter)) {
    throw new Error('Invalid ProviderAdapter — missing required methods');
  }
  const info = adapter.getInfo();
  registry.set(info.id, adapter);
}

/**
 * @param {string} providerId
 * @returns {import('./provider-interface.js').ProviderAdapter}
 */
export function getProviderAdapter(providerId) {
  const adapter = registry.get(providerId);
  if (!adapter) {
    throw new Error(`Provider adapter not registered: ${providerId}`);
  }
  return adapter;
}

/**
 * @param {string} [providerId]
 */
export function tryGetProviderAdapter(providerId) {
  if (!providerId) return null;
  return registry.get(providerId) ?? null;
}

/**
 * Default marketplace provider for getGpuService() when no machine/provider is known.
 * Aligns with PROVIDER_ROUTING — Vast primary, Clore secondary.
 * Override with GPU_PROVIDER / DEFAULT_GPU_PROVIDER.
 * @returns {string}
 */
export function getDefaultProviderId() {
  const fromEnv = (process.env.GPU_PROVIDER ?? process.env.DEFAULT_GPU_PROVIDER ?? '').trim();
  if (fromEnv) return fromEnv;
  return 'vast';
}

/**
 * @returns {import('./provider-interface.js').ProviderAdapter}
 */
export function getDefaultProviderAdapter() {
  if (defaultAdapter) return defaultAdapter;
  return getProviderAdapter(getDefaultProviderId());
}

/**
 * @param {import('./provider-interface.js').ProviderAdapter} adapter
 */
export function setDefaultProviderAdapter(adapter) {
  registerProviderAdapter(adapter);
  defaultAdapter = adapter;
}

/**
 * @returns {Array<{ id: string; name: string; version: string; capabilities: import('./provider-capabilities.js').ProviderCapabilities }>}
 */
export function listRegisteredProviders() {
  return [...registry.values()].map((adapter) => {
    const info = adapter.getInfo();
    return {
      id: info.id,
      name: info.name,
      version: info.version,
      capabilities: adapter.getCapabilities(),
    };
  });
}

/**
 * Reset registry — tests only.
 */
export function resetProviderRegistryForTests() {
  registry.clear();
  defaultAdapter = null;
}

/**
 * @param {string} providerId
 * @returns {import('./provider-capabilities.js').ProviderCapabilities}
 */
export function getProviderCapabilities(providerId) {
  return getProviderAdapter(providerId).getCapabilities();
}
