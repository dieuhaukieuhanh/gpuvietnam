function envMs(name, fallback) {
  const raw = Number(process.env[name] ?? fallback);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export const CAPABILITY_CACHE = {
  storeFile: process.env.PROVIDER_CAP_CACHE_FILE || 'tmp/provider-capability-cache.json',
  /** Soft TTL — serve fresh within this window. */
  currenciesTtlMs: envMs('PROVIDER_CAP_CURRENCIES_TTL_MS', 10 * 60 * 1000),
  capabilitiesTtlMs: envMs('PROVIDER_CAP_CAPABILITIES_TTL_MS', 30 * 60 * 1000),
  marketplaceMetaTtlMs: envMs('PROVIDER_CAP_MARKETPLACE_META_TTL_MS', 30 * 60 * 1000),
  /**
   * Hard stale window — after soft TTL, still serve stale until this age,
   * while refreshing in the background.
   */
  staleGraceMs: envMs('PROVIDER_CAP_STALE_GRACE_MS', 2 * 60 * 60 * 1000),
  /** Min gap between background refresh attempts per key (retry-storm protection). */
  refreshCooldownMs: envMs('PROVIDER_CAP_REFRESH_COOLDOWN_MS', 30 * 1000),
};

export const CACHE_TYPE = {
  CURRENCIES: 'currencies',
  CAPABILITIES: 'capabilities',
  MARKETPLACE_META: 'marketplace_meta',
};

/**
 * @param {string} cacheType
 */
export function ttlForCacheType(cacheType) {
  switch (cacheType) {
    case CACHE_TYPE.CURRENCIES:
      return CAPABILITY_CACHE.currenciesTtlMs;
    case CACHE_TYPE.MARKETPLACE_META:
      return CAPABILITY_CACHE.marketplaceMetaTtlMs;
    case CACHE_TYPE.CAPABILITIES:
    default:
      return CAPABILITY_CACHE.capabilitiesTtlMs;
  }
}

/**
 * @param {string} provider
 * @param {string} cacheType
 */
export function capabilityCacheKey(provider, cacheType) {
  return String(provider || 'unknown').toLowerCase() + ':' + String(cacheType || 'capabilities');
}