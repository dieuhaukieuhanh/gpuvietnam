import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyCloreRankedPriceGuard } from './clore-price-guard.js';

function offer(id, dailyUsd) {
  return {
    offerId: id,
    pricePerHour: dailyUsd / 24,
    uptimePercent: 99,
    pingMs: 100,
    region: 'X',
    gpuType: 'RTX 4090',
    vramGb: 24,
    uptimeGroup: 'A',
    reason: 'test',
  };
}

describe('applyCloreRankedPriceGuard', () => {
  it('drops outliers above 2x cheapest and absolute daily cap', () => {
    const ranked = [
      offer(1, 3.2),
      offer(2, 3.5),
      offer(3, 5.0),
      offer(4, 10),
      offer(5, 15),
    ];
    const { offers, dropped, cheapestDaily, capDaily } = applyCloreRankedPriceGuard(ranked, {
      maxMultipleOfCheapest: 2,
      maxDailyUsd: 10,
    });
    assert.equal(cheapestDaily, 3.2);
    assert.equal(capDaily, 6.4); // min(3.2*2, 10)
    assert.equal(dropped, 2);
    assert.deepEqual(
      offers.map((o) => o.offerId),
      [1, 2, 3],
    );
  });

  it('fail-opens when every candidate exceeds the cap', () => {
    const ranked = [offer(9, 12), offer(10, 15)];
    const { offers, dropped } = applyCloreRankedPriceGuard(ranked, {
      maxMultipleOfCheapest: 1.1,
      maxDailyUsd: 5,
    });
    // cheapest=12 → relative cap 13.2, absolute 5 → cap 5 → all dropped → fail-open
    assert.equal(dropped, 0);
    assert.equal(offers.length, 2);
  });

  it('can be disabled', () => {
    const ranked = [offer(1, 3), offer(2, 15)];
    const { offers, dropped } = applyCloreRankedPriceGuard(ranked, { enabled: false });
    assert.equal(dropped, 0);
    assert.equal(offers.length, 2);
  });
});
