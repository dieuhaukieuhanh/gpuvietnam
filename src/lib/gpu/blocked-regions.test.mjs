import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filterOffersByBlockedRegions,
  isMarketplaceRegionPermanentlyBlocked,
  isOfferRegionBlocked,
} from './blocked-regions.js';

describe('marketplace blocked regions (IR only; UA allowed)', () => {
  it('blocks Iran codes and names; allows Ukraine', () => {
    assert.equal(isMarketplaceRegionPermanentlyBlocked('UA'), false);
    assert.equal(isMarketplaceRegionPermanentlyBlocked('Ukraine'), false);
    assert.equal(isMarketplaceRegionPermanentlyBlocked('Kyiv, UA'), false);
    assert.equal(isMarketplaceRegionPermanentlyBlocked('IR'), true);
    assert.equal(isMarketplaceRegionPermanentlyBlocked('Iran'), true);
    assert.equal(isMarketplaceRegionPermanentlyBlocked('US'), false);
    assert.equal(isMarketplaceRegionPermanentlyBlocked('Japan'), false);
  });

  it('blocks vast-style geolocation offers for Iran only', () => {
    assert.equal(
      isOfferRegionBlocked({
        region: 'Unknown',
        raw: { geolocation: 'Tehran, IR' },
      }),
      true,
    );
    assert.equal(
      isOfferRegionBlocked({
        region: 'Unknown',
        raw: { geolocation: 'Kyiv, UA' },
      }),
      false,
    );
    assert.equal(
      isOfferRegionBlocked({
        region: 'Singapore',
        raw: { geolocation: 'Singapore, SG' },
      }),
      false,
    );
  });

  it('filterOffersByBlockedRegions drops Iran, keeps Ukraine', () => {
    const { offers, droppedBlockedRegion } = filterOffersByBlockedRegions(
      [
        { offerId: 1, region: 'Ukraine', raw: { geolocation: 'UA' } },
        { offerId: 2, region: 'Iran', raw: { geolocation: 'IR' } },
        { offerId: 3, region: 'Canada', raw: { geolocation: 'CA' } },
      ],
      'test',
    );
    assert.equal(droppedBlockedRegion, 1);
    assert.equal(offers.length, 2);
    assert.deepEqual(
      offers.map((o) => o.offerId).sort(),
      [1, 3],
    );
  });
});
