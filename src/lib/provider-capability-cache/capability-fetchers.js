/**
 * Provider-specific capability discovery (no marketplace inventory caching).
 */

import {
  CLORE_CAPABILITIES,
  VAST_CAPABILITIES,
  defineProviderCapabilities,
} from '../gpu/provider-abstraction/provider-capabilities.js';
import { getDefaultGpuRegions } from '../gpu/gpu-config.js';

/**
 * @param {unknown} payload
 * @returns {string[]}
 */
export function extractCurrencyNamesFromWallets(payload) {
  /** @type {Set<string>} */
  const names = new Set();
  if (!payload || typeof payload !== 'object') return [];
  const root = /** @type {Record<string, unknown>} */ (payload);
  const wallets = root.wallets ?? root.data ?? payload;
  if (Array.isArray(wallets)) {
    for (const row of wallets) {
      if (!row || typeof row !== 'object') continue;
      const rec = /** @type {Record<string, unknown>} */ (row);
      const name = String(rec.currency ?? rec.name ?? rec.ticker ?? '').trim();
      if (name) names.add(name);
    }
  } else if (wallets && typeof wallets === 'object') {
    for (const key of Object.keys(/** @type {Record<string, unknown>} */ (wallets))) {
      if (key) names.add(key);
    }
  }
  return [...names].sort();
}

/**
 * Build currencies cache payload from a wallets API response.
 * Does not store balances.
 * @param {unknown} walletsPayload
 */
export function currenciesDataFromWallets(walletsPayload) {
  const supportedCurrencies = extractCurrencyNamesFromWallets(walletsPayload);
  return {
    supportedCurrencies,
    allowedCoins: supportedCurrencies,
  };
}

/**
 * @param {import('../gpu/providers/clore/clore-client.js').CloreClient} client
 */
export async function fetchCloreCapabilitySnapshot(client) {
  const walletsPayload = await client.request('GET', '/wallets');
  const currencies = currenciesDataFromWallets(walletsPayload);
  const staticCaps = defineProviderCapabilities({ ...CLORE_CAPABILITIES });
  return {
    provider: 'clore',
    version: '1.0.0',
    supportedCurrencies: currencies.supportedCurrencies,
    allowedCoins: currencies.allowedCoins,
    marketplaceCapabilities: {
      partialGpuSupport: true,
      spotMarketplace: true,
      docker: true,
    },
    maxGpuCount: 2,
    regions: [...staticCaps.regions],
    gpuTypes: [...staticCaps.gpuTypes],
    supportsSpot: staticCaps.supportsSpot,
    supportsReserved: staticCaps.supportsReserved,
    supportsDocker: staticCaps.supportsDocker,
    pricingModel: staticCaps.pricingModel,
    billingGranularity: staticCaps.billingGranularity,
    implemented: true,
  };
}

/**
 * Vast capabilities are mostly static today (regions from config).
 * No marketplace inventory is stored.
 */
export async function fetchVastCapabilitySnapshot() {
  const regions = getDefaultGpuRegions();
  const staticCaps = defineProviderCapabilities({
    ...VAST_CAPABILITIES,
    regions,
  });
  return {
    provider: 'vast',
    version: '1.0.0',
    supportedCurrencies: ['USD'],
    allowedCoins: ['USD'],
    marketplaceCapabilities: {
      partialGpuSupport: false,
      spotMarketplace: true,
      docker: true,
    },
    maxGpuCount: null,
    regions: [...staticCaps.regions],
    gpuTypes: [...staticCaps.gpuTypes],
    supportsSpot: staticCaps.supportsSpot,
    supportsReserved: staticCaps.supportsReserved,
    supportsDocker: staticCaps.supportsDocker,
    pricingModel: staticCaps.pricingModel,
    billingGranularity: staticCaps.billingGranularity,
    implemented: true,
  };
}
