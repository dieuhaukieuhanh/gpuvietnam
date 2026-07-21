/**
 * Provider Capability Cache — currencies & marketplace capability metadata.
 * Independent from live marketplace inventory / offer selection.
 */

import { CACHE_TYPE } from './capability-cache-config.js';
import {
  getOrFetchCapability,
  putCapabilityCacheData,
  invalidateCapabilityCache,
} from './capability-cache-core.js';
import {
  currenciesDataFromWallets,
  extractCurrencyNamesFromWallets,
  fetchCloreCapabilitySnapshot,
  fetchVastCapabilitySnapshot,
} from './capability-fetchers.js';
import { getCapabilityCacheMetrics } from './capability-cache-metrics.js';
import { resetCapabilityCacheStoreForTests } from './capability-cache-store.js';
import { resetCapabilityCacheMetrics } from './capability-cache-metrics.js';

export { CACHE_TYPE, CAPABILITY_CACHE, ttlForCacheType } from './capability-cache-config.js';
export { invalidateCapabilityCache, putCapabilityCacheData, getOrFetchCapability } from './capability-cache-core.js';
export {
  currenciesDataFromWallets,
  extractCurrencyNamesFromWallets,
  fetchCloreCapabilitySnapshot,
  fetchVastCapabilitySnapshot,
} from './capability-fetchers.js';
export { getCapabilityCacheMetrics, resetCapabilityCacheMetrics } from './capability-cache-metrics.js';
export { resetCapabilityCacheStoreForTests } from './capability-cache-store.js';

/**
 * @param {string} provider
 * @param {() => Promise<Record<string, unknown>>} fetcher
 * @param {{ requestId?: string|null; forceRefresh?: boolean }} [options]
 */
export async function getCachedProviderCapabilities(provider, fetcher, options = {}) {
  return getOrFetchCapability(provider, CACHE_TYPE.CAPABILITIES, fetcher, options);
}

/**
 * @param {string} provider
 * @param {() => Promise<Record<string, unknown>>} fetcher
 * @param {{ requestId?: string|null; forceRefresh?: boolean }} [options]
 */
export async function getCachedProviderCurrencies(provider, fetcher, options = {}) {
  return getOrFetchCapability(provider, CACHE_TYPE.CURRENCIES, fetcher, options);
}

/**
 * @param {string} provider
 * @param {() => Promise<Record<string, unknown>>} fetcher
 * @param {{ requestId?: string|null; forceRefresh?: boolean }} [options]
 */
export async function getCachedMarketplaceMeta(provider, fetcher, options = {}) {
  return getOrFetchCapability(provider, CACHE_TYPE.MARKETPLACE_META, fetcher, options);
}

/**
 * Convenience: Clore full capability snapshot (SWR).
 * @param {import('../gpu/providers/clore/clore-client.js').CloreClient} client
 * @param {{ requestId?: string|null; forceRefresh?: boolean }} [options]
 */
export async function getCloreCapabilitiesCached(client, options = {}) {
  return getCachedProviderCapabilities(
    'clore',
    () => fetchCloreCapabilitySnapshot(client),
    options,
  );
}

/**
 * Convenience: Clore currencies only (SWR).
 * @param {import('../gpu/providers/clore/clore-client.js').CloreClient} client
 * @param {{ requestId?: string|null; forceRefresh?: boolean }} [options]
 */
export async function getCloreCurrenciesCached(client, options = {}) {
  return getCachedProviderCurrencies(
    'clore',
    async () => {
      const payload = await client.request('GET', '/wallets');
      return currenciesDataFromWallets(payload);
    },
    options,
  );
}

/**
 * @param {{ requestId?: string|null; forceRefresh?: boolean }} [options]
 */
export async function getVastCapabilitiesCached(options = {}) {
  return getCachedProviderCapabilities('vast', () => fetchVastCapabilitySnapshot(), options);
}

/**
 * After a live wallets response, seed currency cache (no extra API call).
 * @param {string} provider
 * @param {unknown} walletsPayload
 * @param {{ requestId?: string|null }} [options]
 */
export function seedCurrenciesFromWallets(provider, walletsPayload, options = {}) {
  const data = currenciesDataFromWallets(walletsPayload);
  putCapabilityCacheData(provider, CACHE_TYPE.CURRENCIES, data, options);
  return data;
}