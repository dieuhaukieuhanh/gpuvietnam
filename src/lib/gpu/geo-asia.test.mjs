import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ASIA_GEO_KEYWORDS,
  ASIA_REGION_SCORES,
  OTHER_ASIA_REGION_SCORE,
  getAsiaRegionScore,
  isAsianGeolocation,
  isPreferredAsianGeolocation,
  resolveAsiaRegionLabel,
} from './geo-asia.js';

describe('geo-asia (contains-based Asia detection)', () => {
  it('exposes the full Asia keyword set (codes + names + cities)', () => {
    for (const code of ['tw', 'twn', 'jp', 'jpn', 'sg', 'sgp', 'hk', 'hkg', 'kr', 'kor', 'th', 'tha', 'my', 'mys', 'id', 'idn', 'vn', 'vnm', 'ph', 'phl', 'cn', 'chn', 'in', 'ind', 'mo', 'mac', 'il', 'tr', 'ae']) {
      assert.ok(ASIA_GEO_KEYWORDS.has(code), `missing country code keyword: ${code}`);
    }
    for (const name of [
      'taiwan', 'japan', 'singapore', 'hong kong', 'south korea', 'korea', 'thailand',
      'malaysia', 'indonesia', 'vietnam', 'viet nam', 'philippines', 'china', 'india', 'macau', 'macao',
      'israel', 'turkey', 'dubai',
    ]) {
      assert.ok(ASIA_GEO_KEYWORDS.has(name), `missing country name keyword: ${name}`);
    }
    for (const city of [
      'bangkok', 'jakarta', 'kuala lumpur', 'manila', 'hanoi', 'ho chi minh', 'mumbai',
      'delhi', 'seoul', 'busan', 'tokyo', 'osaka', 'taipei', 'shanghai', 'shenzhen', 'bangalore',
    ]) {
      assert.ok(ASIA_GEO_KEYWORDS.has(city), `missing city keyword: ${city}`);
    }
  });

  it('recognises Asia offers regardless of geolocation string format', () => {
    const asianSamples = [
      'Taiwan, TW', 'TW', 'TWN', 'Taipei, Taiwan', 'Hong Kong', 'HK', 'HKG', 'HongKong',
      'Bangkok, Thailand', 'TH', 'THA', 'Jakarta, Indonesia', 'ID', 'IDN',
      'Kuala Lumpur, Malaysia', 'Manila, Philippines', 'Hanoi, Vietnam', 'Viet Nam', 'VNM',
      'Ho Chi Minh City, Vietnam', 'Mumbai, India', 'Delhi, India', 'IN', 'IND',
      'Seoul, South Korea', 'KR', 'KOR', 'SouthKorea', 'Busan, KR',
      'Tokyo, Japan', 'Osaka, Japan', 'JP', 'JPN',
      'Singapore', 'SG', 'SGP', 'China', 'CN', 'CHN', 'Shanghai', 'Shenzhen',
      'Macau', 'MO', 'MAC', 'Macao', 'Dubai, AE', 'IL', 'TR', 'Bangalore, India',
    ];
    for (const geo of asianSamples) {
      assert.equal(isAsianGeolocation(geo), true, `expected Asia: ${geo}`);
    }
  });

  it('does not match a bare 2-letter Asia code embedded inside an unrelated word', () => {
    // "th" inside "Netherlands", "in" inside "Finland"/"Argentina"/"Indiana".
    const nonAsianSamples = [
      'United States, US', 'US', 'Germany, DE', 'Netherlands, NL',
      'Sydney, Australia', 'Finland', 'Argentina', 'Indiana, US', 'Ireland',
    ];
    for (const geo of nonAsianSamples) {
      assert.equal(isAsianGeolocation(geo), false, `expected NOT Asia: ${geo}`);
    }
  });

  it('preferred mode only matches the nearby-priority regions', () => {
    assert.equal(isPreferredAsianGeolocation('Taiwan, TW'), true);
    assert.equal(isPreferredAsianGeolocation('Tokyo, Japan'), true);
    assert.equal(isPreferredAsianGeolocation('Singapore'), true);
    assert.equal(isPreferredAsianGeolocation('Hong Kong'), true);
    assert.equal(isPreferredAsianGeolocation('Bangkok, Thailand'), true);
    assert.equal(isPreferredAsianGeolocation('Mumbai, India'), false);
    assert.equal(isPreferredAsianGeolocation('Jakarta, Indonesia'), false);
  });

  it('resolves the canonical region label used for scoring', () => {
    assert.equal(resolveAsiaRegionLabel('Taipei, Taiwan, TW'), 'Taiwan');
    assert.equal(resolveAsiaRegionLabel('Bangkok, Thailand'), 'Thailand');
    assert.equal(resolveAsiaRegionLabel('Singapore, SG'), 'Singapore');
    assert.equal(resolveAsiaRegionLabel('Hong Kong'), 'Hong Kong');
    assert.equal(resolveAsiaRegionLabel('Seoul, South Korea'), 'South Korea');
    assert.equal(resolveAsiaRegionLabel('Germany, DE'), null);
    assert.equal(resolveAsiaRegionLabel('TWN'), 'Taiwan');
    assert.equal(resolveAsiaRegionLabel('JPN'), 'Japan');
    assert.equal(resolveAsiaRegionLabel('Viet Nam'), 'Vietnam');
    assert.equal(resolveAsiaRegionLabel('SouthKorea'), 'South Korea');
    assert.equal(resolveAsiaRegionLabel('Shanghai, CN'), 'China');
    assert.equal(resolveAsiaRegionLabel('Dubai'), 'United Arab Emirates');
    assert.equal(resolveAsiaRegionLabel('IL'), 'Israel');
  });

  it('scores every region per the GPU scoring spec (Region = 15% weight)', () => {
    assert.equal(getAsiaRegionScore('Taiwan, TW'), 90);
    assert.equal(getAsiaRegionScore('Bangkok, Thailand'), 85);
    assert.equal(getAsiaRegionScore('Singapore'), 80);
    assert.equal(getAsiaRegionScore('Hong Kong'), 80);
    assert.equal(getAsiaRegionScore('Tokyo, Japan'), 75);
    assert.equal(getAsiaRegionScore('Seoul, South Korea'), 70);
    assert.equal(getAsiaRegionScore('Jakarta, Indonesia'), 65);
    assert.equal(getAsiaRegionScore('Kuala Lumpur, Malaysia'), 65);
    assert.equal(getAsiaRegionScore('Mumbai, India'), 65);
    assert.equal(getAsiaRegionScore('Hanoi, Vietnam'), OTHER_ASIA_REGION_SCORE);
    assert.equal(getAsiaRegionScore('Manila, Philippines'), OTHER_ASIA_REGION_SCORE);
    assert.equal(getAsiaRegionScore('China'), OTHER_ASIA_REGION_SCORE);
    assert.equal(getAsiaRegionScore('Macau'), OTHER_ASIA_REGION_SCORE);
    assert.equal(getAsiaRegionScore('Sydney, Australia'), 0);
    assert.equal(Object.keys(ASIA_REGION_SCORES).length, 9);
  });

  it('handles empty/missing geolocation gracefully', () => {
    assert.equal(isAsianGeolocation(''), false);
    assert.equal(isAsianGeolocation(undefined), false);
    assert.equal(isAsianGeolocation(null), false);
    assert.equal(resolveAsiaRegionLabel(''), null);
    assert.equal(getAsiaRegionScore(''), 0);
  });
});
