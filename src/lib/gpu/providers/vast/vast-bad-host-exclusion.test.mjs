import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  filterVastOffersByBadHostExclusion,
  isVastHostExcluded,
  listVastBadHostExclusionsForTests,
  rememberVastBadHost,
  resetVastBadHostExclusionForTests,
  resolveVastHostKey,
} from './vast-bad-host-exclusion.js';

describe('vast-bad-host-exclusion', () => {
  beforeEach(() => {
    resetVastBadHostExclusionForTests();
  });

  it('resolves machine_id / host_id keys', () => {
    assert.equal(resolveVastHostKey({ machine_id: 7788 }), 'vast-host:7788');
    assert.equal(resolveVastHostKey({ host_id: '99' }), 'vast-host:99');
    assert.equal(resolveVastHostKey({ machine: { id: 12 } }), 'vast-host:12');
    assert.equal(resolveVastHostKey({ id: 1 }), null);
  });

  it('remembers and excludes hosts until TTL', () => {
    const key = resolveVastHostKey({ machine_id: 4441 });
    assert.ok(key);
    rememberVastBadHost(key, { reason: 'No such container', offerId: '10', instanceId: '20' });
    assert.equal(isVastHostExcluded(key), true);
    assert.equal(listVastBadHostExclusionsForTests().length, 1);
  });

  it('filters normalized offers by excluded host', () => {
    rememberVastBadHost('vast-host:55', { reason: 'exited' });
    const offers = [
      {
        offerId: 1,
        providerId: 'vast',
        pricePerHour: 0.3,
        uptimePercent: 99,
        pingMs: 100,
        vramGb: 24,
        diskGb: 100,
        numGpus: 1,
        gpuType: 'RTX 3090',
        region: 'Taiwan',
        raw: { machine_id: 55, id: 1, geolocation: 'Taiwan, TW' },
      },
      {
        offerId: 2,
        providerId: 'vast',
        pricePerHour: 0.32,
        uptimePercent: 99,
        pingMs: 100,
        vramGb: 24,
        diskGb: 100,
        numGpus: 1,
        gpuType: 'RTX 3090',
        region: 'Singapore',
        raw: { machine_id: 66, id: 2, geolocation: 'Singapore, SG' },
      },
    ];
    const { offers: kept, droppedExcludedHost } = filterVastOffersByBadHostExclusion(offers);
    assert.equal(droppedExcludedHost, 1);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].offerId, 2);
  });

  it('permanently drops Ukraine and Iran regions', () => {
    const offers = [
      {
        offerId: 10,
        providerId: 'vast',
        pricePerHour: 0.2,
        uptimePercent: 99,
        pingMs: 100,
        vramGb: 24,
        diskGb: 100,
        numGpus: 1,
        gpuType: 'RTX 3090',
        region: 'Ukraine',
        raw: { machine_id: 100, id: 10, geolocation: 'Kyiv, UA' },
      },
      {
        offerId: 11,
        providerId: 'vast',
        pricePerHour: 0.2,
        uptimePercent: 99,
        pingMs: 100,
        vramGb: 24,
        diskGb: 100,
        numGpus: 1,
        gpuType: 'RTX 3090',
        region: 'Iran',
        raw: { machine_id: 101, id: 11, geolocation: 'IR' },
      },
      {
        offerId: 12,
        providerId: 'vast',
        pricePerHour: 0.25,
        uptimePercent: 99,
        pingMs: 100,
        vramGb: 24,
        diskGb: 100,
        numGpus: 1,
        gpuType: 'RTX 3090',
        region: 'Japan',
        raw: { machine_id: 102, id: 12, geolocation: 'Tokyo, JP' },
      },
    ];
    const { offers: kept, droppedBlockedRegion } = filterVastOffersByBadHostExclusion(
      /** @type {any} */ (offers),
    );
    assert.equal(droppedBlockedRegion, 2);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].offerId, 12);
  });

  it('expires entries', () => {
    const now = Date.now();
    rememberVastBadHost('vast-host:1', { reason: 'x', now: now - 10 });
    // Force expire by remembering with past expires via direct check
    const entry = listVastBadHostExclusionsForTests()[0];
    entry.expiresAt = now - 1;
    assert.equal(isVastHostExcluded('vast-host:1', now), false);
  });
});
