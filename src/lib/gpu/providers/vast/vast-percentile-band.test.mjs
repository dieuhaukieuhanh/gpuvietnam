import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { VAST_PERCENTILE_BAND } from '../../gpu-config.js';
import {
  applyVastPercentilePriceBand,
  percentileSorted,
  resolvePercentilePlanBucket,
} from './vast-percentile-band.js';

function offer(id, price) {
  return {
    offerId: id,
    pricePerHour: price,
    uptimePercent: 99,
    pingMs: 50,
    gpuType: 'RTX 3090',
    vramGb: 24,
    diskGb: 50,
    numGpus: 1,
    rentable: true,
    raw: {},
  };
}

describe('percentileSorted', () => {
  it('interpolates', () => {
    assert.equal(percentileSorted([1, 2, 3, 4], 0), 1);
    assert.equal(percentileSorted([1, 2, 3, 4], 1), 4);
    assert.ok(Math.abs(percentileSorted([1, 2, 3, 4], 0.5) - 2.5) < 1e-9);
  });
});

describe('resolvePercentilePlanBucket', () => {
  it('maps plans', () => {
    assert.equal(resolvePercentilePlanBucket('Starter'), 'starter');
    assert.equal(resolvePercentilePlanBucket('Pro'), 'pro');
    assert.equal(resolvePercentilePlanBucket('Studio'), 'studio');
  });
});

describe('applyVastPercentilePriceBand (disabled)', () => {
  it('passes through all offers for every plan while enabled=false', () => {
    assert.equal(VAST_PERCENTILE_BAND.enabled, false);
    for (const plan of ['starter', 'pro', 'studio']) {
      const offers = Array.from({ length: 10 }, (_, i) => offer(String(i), 0.1 + i * 0.01));
      const r = applyVastPercentilePriceBand(offers, { plan });
      assert.equal(r.mode, 'disabled');
      assert.equal(r.dropped, 0);
      assert.equal(r.offers.length, 10);
    }
  });
});

describe('applyVastPercentilePriceBand (enabled)', () => {
  let previous;
  before(() => {
    previous = VAST_PERCENTILE_BAND.enabled;
    VAST_PERCENTILE_BAND.enabled = true;
  });
  after(() => {
    VAST_PERCENTILE_BAND.enabled = previous;
  });

  it('drops bottom fraction for starter full cohort', () => {
    const offers = Array.from({ length: 10 }, (_, i) => offer(String(i), 0.1 + i * 0.01));
    const r = applyVastPercentilePriceBand(offers, { plan: 'starter' });
    assert.equal(r.mode.startsWith('starter_drop_bottom_'), true);
    assert.ok(r.dropped >= 1);
    assert.ok(r.offers.every((o) => o.pricePerHour >= (r.low ?? 0)));
  });

  it('keeps thin cohort almost intact for starter', () => {
    const offers = [offer('a', 0.1), offer('b', 0.2), offer('c', 0.3), offer('d', 0.4), offer('e', 0.5)];
    const r = applyVastPercentilePriceBand(offers, { plan: 'starter' });
    assert.equal(r.dropped, 1);
    assert.equal(r.offers.length, 4);
  });

  it('applies P40-P70 for pro full cohort', () => {
    const offers = Array.from({ length: 10 }, (_, i) => offer(String(i), 0.2 + i * 0.02));
    const r = applyVastPercentilePriceBand(offers, { plan: 'pro' });
    assert.match(r.mode, /pro_studio/);
    assert.ok(r.offers.length < offers.length);
    assert.ok(r.offers.length > 0);
  });

  it('does not empty cohort when band too tight', () => {
    const offers = Array.from({ length: 8 }, (_, i) => offer(String(i), 1));
    const r = applyVastPercentilePriceBand(offers, { plan: 'studio' });
    assert.ok(r.offers.length >= 1);
  });

  it('skips band when cohort tiny', () => {
    const offers = [offer('a', 0.1), offer('b', 0.2)];
    const r = applyVastPercentilePriceBand(offers, { plan: 'pro' });
    assert.equal(r.mode, 'cohort_too_small');
    assert.equal(r.offers.length, 2);
  });
});
