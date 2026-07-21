import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filterOffersByBlockedRegions,
  isMarketplaceRegionPermanentlyBlocked,
  isOfferRegionBlocked,
} from './blocked-regions.js';

describe('marketplace blocked regions (UA / IR)', () => {
  it('blocks codes and names', () => {
    assert.equal(isMarketplaceRegionPermanentlyBlocked('UA'), true);
    assert.equal(isMarketplaceRegionPermanentlyBlocked('Ukraine'), true);
    assert.equal(isMarketplaceRegionPermanentlyBlocked('Kyiv, UA'), true);
    assert.equal(isMarketplaceRegionPermanentlyBlocked('IR'), true);
    assert.equal(isMarketplaceRegionPermanentlyBlocked('Iran'), true);
    assert.equal(isMarketplaceRegionPermanentlyBlocked('US'), false);
    assert.equal(isMarketplaceRegionPermanentlyBlocked('Japan'), false);
  });

  it('blocks vast-style geolocation offers', () => {
    assert.equal(
      isOfferRegionBlocked({
        region: 'Unknown',
        raw: { geolocation: 'Tehran, IR' },
      }),
      true,
    );
    assert.equal(
      isOfferRegionBlocked({
        region: 'Singapore',
        raw: { geolocation: 'Singapore, SG' },
      }),
      false,
    );
  });

  it('filterOffersByBlockedRegions drops blocked', () => {
    const { offers, droppedBlockedRegion } = filterOffersByBlockedRegions(
      [
        { offerId: 1, region: 'Ukraine', raw: { geolocation: 'UA' } },
        { offerId: 2, region: 'Canada', raw: { geolocation: 'CA' } },
      ],
      'test',
    );
    assert.equal(droppedBlockedRegion, 1);
    assert.equal(offers.length, 1);
    assert.equal(offers[0].offerId, 2);
  });
});
