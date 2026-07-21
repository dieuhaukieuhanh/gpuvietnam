import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLORE_BAD_HOST } from '../../gpu-config.js';
import { classifyCloreGateFailReason } from './clore-provision-gate.js';
import {
  filterCloreOffersByBadHostExclusion,
  filterCloreOffersByBlockedRegions,
  isCloreHostExcluded,
  isCloreRegionPermanentlyBlocked,
  rememberCloreBadHost,
  resetCloreBadHostExclusionForTests,
} from './clore-bad-host-exclusion.js';

describe('classifyCloreGateFailReason', () => {
  it('maps like Vast', () => {
    assert.equal(classifyCloreGateFailReason('ssh_exec timeout'), 'ssh_exec');
    assert.equal(classifyCloreGateFailReason('nvidia_smi: mismatch'), 'nvidia_smi');
    assert.equal(classifyCloreGateFailReason('comfy_workflow timeout'), 'comfy_workflow');
  });
});

describe('clore-bad-host-exclusion', () => {
  it('remembers and excludes by 30-day TTL', () => {
    resetCloreBadHostExclusionForTests();
    const now = Date.now();
    const entry = rememberCloreBadHost('clore-host:99', {
      reason: 'http_endpoint: Proxy Not Found',
      reasonCategory: 'http_endpoint',
      now,
    });
    assert.ok(entry);
    const expectedTtl = CLORE_BAD_HOST.badHostExclusionTtlMs;
    assert.ok(expectedTtl >= 29 * 24 * 60 * 60 * 1000);
    assert.equal(entry.expiresAt - entry.excludedAt, expectedTtl);
    assert.equal(isCloreHostExcluded('clore-host:99', now + 1000), true);
    assert.equal(isCloreHostExcluded('clore-host:99|rtx3090', now + 1000), true);
    // After TTL → not excluded
    assert.equal(isCloreHostExcluded('clore-host:99', entry.expiresAt + 1), false);
  });
});

describe('clore permanent region block (UA / IR)', () => {
  it('blocks Ukraine and Iran codes and names', () => {
    assert.equal(isCloreRegionPermanentlyBlocked('UA'), true);
    assert.equal(isCloreRegionPermanentlyBlocked('ua'), true);
    assert.equal(isCloreRegionPermanentlyBlocked('Ukraine'), true);
    assert.equal(isCloreRegionPermanentlyBlocked('IR'), true);
    assert.equal(isCloreRegionPermanentlyBlocked('Iran'), true);
    assert.equal(isCloreRegionPermanentlyBlocked('US'), false);
    assert.equal(isCloreRegionPermanentlyBlocked('Argentina'), false);
  });

  it('filters offers from blocked regions', () => {
    const offers = [
      {
        offerId: 1,
        providerId: 'clore',
        region: 'Ukraine',
        raw: { id: 1, specs: { net: { cc: 'UA' } } },
      },
      {
        offerId: 2,
        providerId: 'clore',
        region: 'Iran',
        raw: { id: 2, specs: { net: { cc: 'IR' } } },
      },
      {
        offerId: 3,
        providerId: 'clore',
        region: 'US Central',
        raw: { id: 3, specs: { net: { cc: 'US' } } },
      },
    ];
    const { offers: kept, droppedBlockedRegion } = filterCloreOffersByBlockedRegions(
      /** @type {any} */ (offers),
    );
    assert.equal(droppedBlockedRegion, 2);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].offerId, 3);
  });

  it('bad-host filter also drops blocked regions', () => {
    resetCloreBadHostExclusionForTests();
    const offers = [
      {
        offerId: 88411,
        providerId: 'clore',
        region: 'Ukraine',
        raw: { id: 88411, specs: { net: { cc: 'UA' } } },
      },
      {
        offerId: 88028,
        providerId: 'clore',
        region: 'US Central',
        raw: { id: 88028, specs: { net: { cc: 'US' } } },
      },
    ];
    const { offers: kept, droppedBlockedRegion } = filterCloreOffersByBadHostExclusion(
      /** @type {any} */ (offers),
      'rtx3090',
    );
    assert.equal(droppedBlockedRegion, 1);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].offerId, 88028);
  });
});
