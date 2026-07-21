import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, beforeEach, afterEach, after } from 'node:test';

const tmpDir = mkdtempSync(join(tmpdir(), 'cap-cache-'));
process.env.PROVIDER_CAP_CACHE_FILE = join(tmpDir, 'cache.json');
process.env.PROVIDER_CAP_CURRENCIES_TTL_MS = '1000';
process.env.PROVIDER_CAP_CAPABILITIES_TTL_MS = '2000';
process.env.PROVIDER_CAP_STALE_GRACE_MS = '60000';
process.env.PROVIDER_CAP_REFRESH_COOLDOWN_MS = '50';

const {
  CACHE_TYPE,
  getOrFetchCapability,
  putCapabilityCacheData,
  invalidateCapabilityCache,
  getCachedProviderCurrencies,
  getVastCapabilitiesCached,
  seedCurrenciesFromWallets,
  extractCurrencyNamesFromWallets,
  currenciesDataFromWallets,
  getCapabilityCacheMetrics,
  resetCapabilityCacheMetrics,
  resetCapabilityCacheStoreForTests,
} = await import('./index.js');

describe('provider-capability-cache', () => {
  beforeEach(() => {
    resetCapabilityCacheStoreForTests();
    resetCapabilityCacheMetrics();
  });

  afterEach(() => {
    resetCapabilityCacheStoreForTests();
    resetCapabilityCacheMetrics();
  });

  it('extracts currency names without balances', () => {
    const names = extractCurrencyNamesFromWallets({
      wallets: [
        { currency: 'USD-Blockchain', balance: 12.5 },
        { currency: 'CLORE', balance: 0 },
      ],
    });
    assert.deepEqual(names, ['CLORE', 'USD-Blockchain']);
    const data = currenciesDataFromWallets({
      wallets: [{ currency: 'BTC', balance: 1 }],
    });
    assert.deepEqual(data.supportedCurrencies, ['BTC']);
    assert.equal(Object.prototype.hasOwnProperty.call(data, 'balance'), false);
  });

  it('miss then hit (fresh)', async () => {
    let fetches = 0;
    const fetcher = async () => {
      fetches += 1;
      return { supportedCurrencies: ['USD-Blockchain'], allowedCoins: ['USD-Blockchain'] };
    };

    const first = await getCachedProviderCurrencies('clore', fetcher);
    assert.equal(first.source, 'fetched');
    assert.equal(fetches, 1);

    const second = await getCachedProviderCurrencies('clore', fetcher);
    assert.equal(second.source, 'fresh');
    assert.equal(fetches, 1);
    assert.deepEqual(second.data.supportedCurrencies, ['USD-Blockchain']);

    const m = getCapabilityCacheMetrics();
    assert.equal(m.misses, 1);
    assert.equal(m.hits, 1);
    assert.equal(m.providerCapabilityRequests, 1);
  });

  it('serves stale and refreshes in background', async () => {
    let fetches = 0;
    const fetcher = async () => {
      fetches += 1;
      return { supportedCurrencies: [`v${fetches}`], allowedCoins: [`v${fetches}`] };
    };

    await getOrFetchCapability('clore', CACHE_TYPE.CURRENCIES, fetcher, {
      now: 1_000_000,
    });
    assert.equal(fetches, 1);

    const stale = await getOrFetchCapability('clore', CACHE_TYPE.CURRENCIES, fetcher, {
      now: 1_000_000 + 1500,
    });
    assert.equal(stale.source, 'stale');
    assert.deepEqual(stale.data.supportedCurrencies, ['v1']);

    await new Promise((r) => setTimeout(r, 80));
    assert.ok(fetches >= 2);
    assert.ok(getCapabilityCacheMetrics().backgroundRefreshCount >= 1);
  });

  it('uses stale_on_error when force refresh fails', async () => {
    putCapabilityCacheData(
      'clore',
      CACHE_TYPE.CURRENCIES,
      { supportedCurrencies: ['USD-Blockchain'], allowedCoins: ['USD-Blockchain'] },
      { now: 1_000 },
    );

    const result = await getOrFetchCapability(
      'clore',
      CACHE_TYPE.CURRENCIES,
      async () => {
        throw new Error('provider down');
      },
      { forceRefresh: true, now: 1_000 },
    );
    assert.equal(result.source, 'stale_on_error');
    assert.deepEqual(result.data.supportedCurrencies, ['USD-Blockchain']);
  });

  it('fails when cache missing and fetch fails', async () => {
    await assert.rejects(
      () =>
        getOrFetchCapability('unknown', CACHE_TYPE.CAPABILITIES, async () => {
          throw new Error('no cache');
        }),
      /no cache/,
    );
  });

  it('seedCurrenciesFromWallets populates cache without fetcher', async () => {
    seedCurrenciesFromWallets('clore', {
      wallets: [{ currency: 'USD-Blockchain' }, { currency: 'CLORE' }],
    });
    const hit = await getCachedProviderCurrencies('clore', async () => {
      throw new Error('should not fetch');
    });
    assert.equal(hit.source, 'fresh');
    assert.deepEqual(hit.data.supportedCurrencies, ['CLORE', 'USD-Blockchain']);
  });

  it('invalidate clears entries', async () => {
    putCapabilityCacheData('clore', CACHE_TYPE.CURRENCIES, {
      supportedCurrencies: ['X'],
      allowedCoins: ['X'],
    });
    invalidateCapabilityCache('clore', CACHE_TYPE.CURRENCIES);
    let fetches = 0;
    await getCachedProviderCurrencies('clore', async () => {
      fetches += 1;
      return { supportedCurrencies: ['Y'], allowedCoins: ['Y'] };
    });
    assert.equal(fetches, 1);
    assert.ok(getCapabilityCacheMetrics().invalidations >= 1);
  });

  it('Vast capabilities snapshot does not call marketplace inventory', async () => {
    const snap = await getVastCapabilitiesCached({ forceRefresh: true });
    assert.equal(snap.source, 'fetched');
    assert.equal(snap.data.provider, 'vast');
    assert.ok(Array.isArray(snap.data.supportedCurrencies));
    assert.ok(snap.data.marketplaceCapabilities);
    assert.equal(Object.prototype.hasOwnProperty.call(snap.data, 'offers'), false);
  });
});

after(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
