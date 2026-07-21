/**
 * Stale-while-revalidate capability cache core.
 */

import {
  CAPABILITY_CACHE,
  capabilityCacheKey,
  ttlForCacheType,
} from './capability-cache-config.js';
import { logCapabilityCacheEvent } from './capability-cache-log.js';
import {
  incrCapabilityCacheMetric,
  recordCapabilityLatency,
} from './capability-cache-metrics.js';
import {
  getCapabilityCacheEntry,
  putCapabilityCacheEntry,
  invalidateCapabilityCacheEntries,
} from './capability-cache-store.js';

/** @type {Map<string, Promise<unknown>>} */
const inFlight = new Map();
/** @type {Map<string, number>} */
const lastRefreshAttempt = new Map();

/**
 * @param {string} provider
 * @param {string} cacheType
 * @param {() => Promise<Record<string, unknown>>} fetcher
 * @param {{ requestId?: string|null; forceRefresh?: boolean; now?: number }} [options]
 */
export async function getOrFetchCapability(provider, cacheType, fetcher, options = {}) {
  const key = capabilityCacheKey(provider, cacheType);
  const ttlMs = ttlForCacheType(cacheType);
  const now = options.now ?? Date.now();
  const entry = getCapabilityCacheEntry(key);
  const ageMs = entry?.fetchedAt != null ? now - Number(entry.fetchedAt) : null;

  if (!options.forceRefresh && entry && ageMs != null && ageMs < ttlMs) {
    incrCapabilityCacheMetric('hits');
    logCapabilityCacheEvent(
      'CAPABILITY_CACHE_HIT',
      {
        requestId: options.requestId,
        provider,
        cacheType,
        ageMs,
        ttlMs,
      },
      'Capability cache hit',
    );
    return {
      data: entry.data,
      source: 'fresh',
      ageMs,
      ttlMs,
      provider,
      cacheType,
    };
  }

  if (
    !options.forceRefresh &&
    entry &&
    ageMs != null &&
    ageMs < ttlMs + CAPABILITY_CACHE.staleGraceMs
  ) {
    incrCapabilityCacheMetric('hits');
    incrCapabilityCacheMetric('staleServes');
    logCapabilityCacheEvent(
      'CAPABILITY_CACHE_STALE',
      {
        requestId: options.requestId,
        provider,
        cacheType,
        ageMs,
        ttlMs,
      },
      'Serving stale capability cache; refreshing in background',
    );
    scheduleBackgroundRefresh(provider, cacheType, key, fetcher, options.requestId);
    return {
      data: entry.data,
      source: 'stale',
      ageMs,
      ttlMs,
      provider,
      cacheType,
    };
  }

  incrCapabilityCacheMetric('misses');
  logCapabilityCacheEvent(
    'CAPABILITY_CACHE_MISS',
    {
      requestId: options.requestId,
      provider,
      cacheType,
      ageMs,
      ttlMs,
    },
    'Capability cache miss — fetching provider',
  );

  try {
    const data = await runFetcher(key, fetcher);
    const saved = writeEntry(key, provider, cacheType, data, ttlMs, now);
    return {
      data: saved.data,
      source: 'fetched',
      ageMs: 0,
      ttlMs,
      provider,
      cacheType,
    };
  } catch (error) {
    if (entry?.data) {
      incrCapabilityCacheMetric('staleServes');
      logCapabilityCacheEvent(
        'CAPABILITY_CACHE_STALE',
        {
          requestId: options.requestId,
          provider,
          cacheType,
          ageMs,
          ttlMs,
          reason: 'fetch_failed_using_stale',
          err: error instanceof Error ? error.message : String(error),
        },
        'Capability fetch failed — using stale cache',
      );
      return {
        data: entry.data,
        source: 'stale_on_error',
        ageMs,
        ttlMs,
        provider,
        cacheType,
      };
    }
    throw error;
  }
}

/**
 * Seed / overwrite cache without a network round-trip (e.g. after wallets fetch).
 * @param {string} provider
 * @param {string} cacheType
 * @param {Record<string, unknown>} data
 * @param {{ requestId?: string|null; now?: number }} [options]
 */
export function putCapabilityCacheData(provider, cacheType, data, options = {}) {
  const key = capabilityCacheKey(provider, cacheType);
  const ttlMs = ttlForCacheType(cacheType);
  const now = options.now ?? Date.now();
  writeEntry(key, provider, cacheType, data, ttlMs, now);
  logCapabilityCacheEvent(
    'CAPABILITY_CACHE_REFRESH',
    {
      requestId: options.requestId,
      provider,
      cacheType,
      ageMs: 0,
      ttlMs,
      reason: 'seed',
    },
    'Capability cache seeded',
  );
}

/**
 * @param {string | null | undefined} [provider]
 * @param {string | null | undefined} [cacheType]
 * @param {{ requestId?: string|null }} [options]
 */
export function invalidateCapabilityCache(provider = null, cacheType = null, options = {}) {
  const prefix =
    provider && cacheType
      ? capabilityCacheKey(provider, cacheType)
      : provider
        ? String(provider).toLowerCase()
        : null;
  invalidateCapabilityCacheEntries(prefix);
  incrCapabilityCacheMetric('invalidations');
  logCapabilityCacheEvent(
    'CAPABILITY_CACHE_INVALIDATED',
    {
      requestId: options.requestId,
      provider: provider ?? null,
      cacheType: cacheType ?? null,
      ageMs: null,
      ttlMs: null,
    },
    'Capability cache invalidated',
  );
}

/**
 * @param {string} key
 * @param {() => Promise<Record<string, unknown>>} fetcher
 */
async function runFetcher(key, fetcher) {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const started = Date.now();
  const promise = (async () => {
    incrCapabilityCacheMetric('providerRequests');
    try {
      return await fetcher();
    } finally {
      recordCapabilityLatency(Date.now() - started);
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

/**
 * @param {string} provider
 * @param {string} cacheType
 * @param {string} key
 * @param {() => Promise<Record<string, unknown>>} fetcher
 * @param {string|null|undefined} requestId
 */
function scheduleBackgroundRefresh(provider, cacheType, key, fetcher, requestId) {
  const now = Date.now();
  const last = lastRefreshAttempt.get(key) || 0;
  if (now - last < CAPABILITY_CACHE.refreshCooldownMs) return;
  if (inFlight.has(key)) return;
  lastRefreshAttempt.set(key, now);
  incrCapabilityCacheMetric('backgroundRefreshCount');
  logCapabilityCacheEvent(
    'CAPABILITY_CACHE_REFRESH',
    {
      requestId,
      provider,
      cacheType,
      ageMs: null,
      ttlMs: ttlForCacheType(cacheType),
      reason: 'background',
    },
    'Background capability cache refresh started',
  );
  void runFetcher(key, fetcher)
    .then((data) => {
      writeEntry(key, provider, cacheType, data, ttlForCacheType(cacheType), Date.now());
    })
    .catch((error) => {
      console.warn(
        '[capability-cache] background refresh failed:',
        error instanceof Error ? error.message : error,
      );
    });
}

/**
 * @param {string} key
 * @param {string} provider
 * @param {string} cacheType
 * @param {Record<string, unknown>} data
 * @param {number} ttlMs
 * @param {number} now
 */
function writeEntry(key, provider, cacheType, data, ttlMs, now) {
  const entry = {
    key,
    provider,
    cacheType,
    fetchedAt: now,
    ttlMs,
    data,
  };
  putCapabilityCacheEntry(key, entry);
  return entry;
}