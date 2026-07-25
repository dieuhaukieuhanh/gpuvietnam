/**
 * Permanent marketplace country/region block (Clore + Vast).
 * Never rent hosts in these countries.
 */

import { CLORE_BLOCKED_REGIONS } from './gpu-config.js';

/** @typedef {{ region?: string | null; raw?: Record<string, unknown> | null }} RegionOfferLike */

/**
 * Shared block list (config currently named CLORE_BLOCKED_REGIONS; applies to all marketplaces).
 */
export const MARKETPLACE_BLOCKED_REGIONS = CLORE_BLOCKED_REGIONS;

/**
 * @param {unknown} regionOrCc
 */
export function isMarketplaceRegionPermanentlyBlocked(regionOrCc) {
  const raw = String(regionOrCc ?? '').trim();
  if (!raw) return false;
  const upper = raw.toUpperCase();
  const lower = raw.toLowerCase();
  const codes = MARKETPLACE_BLOCKED_REGIONS?.countryCodes ?? ['IR'];
  for (const code of codes) {
    const c = String(code).toUpperCase();
    if (upper === c) return true;
    if (new RegExp(`(?:^|[,\\s])${c}(?:$|[,\\s])`).test(upper)) return true;
  }
  const names = MARKETPLACE_BLOCKED_REGIONS?.regionNames ?? ['iran'];
  for (const name of names) {
    const n = String(name).toLowerCase();
    if (!n) continue;
    if (lower === n || lower.includes(n)) return true;
  }
  return false;
}

/**
 * @param {RegionOfferLike | null | undefined} offer
 */
export function isOfferRegionBlocked(offer) {
  if (!offer || typeof offer !== 'object') return false;
  if (isMarketplaceRegionPermanentlyBlocked(offer.region)) return true;
  const raw = offer.raw && typeof offer.raw === 'object' ? offer.raw : null;
  if (!raw) return false;
  const specs =
    raw.specs && typeof raw.specs === 'object'
      ? /** @type {Record<string, unknown>} */ (raw.specs)
      : {};
  const net =
    specs.net && typeof specs.net === 'object'
      ? /** @type {Record<string, unknown>} */ (specs.net)
      : {};
  return (
    isMarketplaceRegionPermanentlyBlocked(net.cc) ||
    isMarketplaceRegionPermanentlyBlocked(specs.cc) ||
    isMarketplaceRegionPermanentlyBlocked(raw.geolocation) ||
    isMarketplaceRegionPermanentlyBlocked(raw.location) ||
    isMarketplaceRegionPermanentlyBlocked(raw.region) ||
    isMarketplaceRegionPermanentlyBlocked(raw.country) ||
    isMarketplaceRegionPermanentlyBlocked(raw.country_code)
  );
}

/**
 * @template {RegionOfferLike} T
 * @param {T[]} offers
 * @param {string} [logTag]
 * @returns {{ offers: T[]; droppedBlockedRegion: number }}
 */
export function filterOffersByBlockedRegions(offers, logTag = 'marketplace') {
  let droppedBlockedRegion = 0;
  /** @type {T[]} */
  const kept = [];
  for (const offer of offers) {
    if (isOfferRegionBlocked(offer)) {
      droppedBlockedRegion += 1;
      continue;
    }
    kept.push(offer);
  }
  if (droppedBlockedRegion > 0) {
    console.info(`[${logTag}/region-block] filtered`, {
      input: offers.length,
      kept: kept.length,
      droppedBlockedRegion,
      blocked: MARKETPLACE_BLOCKED_REGIONS.countryCodes,
    });
  }
  return { offers: kept, droppedBlockedRegion };
}
