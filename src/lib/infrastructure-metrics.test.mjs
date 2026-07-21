import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PING_THRESHOLD_MS,
  UPTIME_THRESHOLD,
  estimatePingMsFromRegion,
  extractPingMs,
  normalizeUptimePercent,
  resolveEffectivePingMs,
  resolveMarketplaceRegionLabel,
  resolvePingBucket,
  resolveUptimeBucket,
} from './infrastructure-metrics.js';

describe('normalizeUptimePercent', () => {
  it('converts 0-1 reliability to percent', () => {
    assert.equal(normalizeUptimePercent(0.995), 99.5);
    assert.equal(normalizeUptimePercent(0.98), 98);
  });

  it('keeps already-percent values', () => {
    assert.equal(normalizeUptimePercent(99.5), 99.5);
    assert.equal(normalizeUptimePercent(98), 98);
  });
});

describe('resolveUptimeBucket', () => {
  it('maps three uptime bands and rejects below threshold', () => {
    assert.equal(resolveUptimeBucket(99.1), 'gt99');
    assert.equal(resolveUptimeBucket(98.7), 'btw_985_99');
    assert.equal(resolveUptimeBucket(98.2), 'btw_98_985');
    assert.equal(resolveUptimeBucket(98), 'btw_98_985');
    assert.equal(resolveUptimeBucket(97.9), null);
    assert.equal(UPTIME_THRESHOLD, 98);
  });
});

describe('resolvePingBucket', () => {
  it('maps four ping bands and rejects above threshold', () => {
    assert.equal(resolvePingBucket(40), 'lt50');
    assert.equal(resolvePingBucket(50), 'btw_50_100');
    assert.equal(resolvePingBucket(99), 'btw_50_100');
    assert.equal(resolvePingBucket(100), 'btw_100_200');
    assert.equal(resolvePingBucket(199), 'btw_100_200');
    assert.equal(resolvePingBucket(200), 'btw_200_250');
    assert.equal(resolvePingBucket(250), 'btw_200_250');
    assert.equal(resolvePingBucket(251), null);
    assert.equal(PING_THRESHOLD_MS, 250);
  });
});

describe('ping extraction / estimation', () => {
  it('reads nested ping fields when present', () => {
    assert.equal(extractPingMs({ ping: 42 }), 42);
    assert.equal(extractPingMs({ latency: { ms: 88 } }), 88);
    assert.equal(extractPingMs({ specs: { net: { ping: 120 } } }), 120);
  });

  it('falls back to VN-region estimate', () => {
    assert.equal(estimatePingMsFromRegion('Singapore'), 45);
    assert.equal(estimatePingMsFromRegion('Japan'), 130);
    assert.equal(resolveEffectivePingMs({}, 'Taiwan'), 75);
    assert.equal(resolveEffectivePingMs({ ping: 33 }, 'Japan'), 33);
  });
});


describe('resolveMarketplaceRegionLabel', () => {
  it('maps global ISO2 and US state geos', () => {
    assert.equal(resolveMarketplaceRegionLabel('California, US', () => null), 'US West');
    assert.equal(resolveMarketplaceRegionLabel('Virginia, US', () => null), 'US East');
    assert.equal(resolveMarketplaceRegionLabel('Texas, US', () => null), 'US Central');
    assert.equal(resolveMarketplaceRegionLabel('United Kingdom, GB', () => null), 'United Kingdom');
    assert.equal(resolveMarketplaceRegionLabel('Czechia, CZ', () => null), 'Czechia');
    assert.equal(resolveMarketplaceRegionLabel('TW', (g) => (g === 'TW' ? 'Taiwan' : null)), 'Taiwan');
  });
});

describe('resolveEffectivePingMs fallback', () => {
  it('uses mid-range default when region unknown', () => {
    assert.equal(resolveEffectivePingMs({}, null), 220);
    assert.equal(resolveEffectivePingMs({}, 'United States'), 200);
    assert.equal(resolveEffectivePingMs({}, 'US West'), 170);
  });
});
