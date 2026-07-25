/**
 * Drop outlier-expensive Clore ranked offers before the rent walk.
 */

import { CLORE_PRICE_GUARD } from '../../gpu-config.js';

/**
 * @param {import('../../offer-selection.js').RankedOffer[]} ranked
 * @param {{
 *   enabled?: boolean;
 *   maxMultipleOfCheapest?: number;
 *   maxDailyUsd?: number;
 * }} [override]
 * @returns {{
 *   offers: import('../../offer-selection.js').RankedOffer[];
 *   dropped: number;
 *   cheapestDaily: number | null;
 *   capDaily: number | null;
 * }}
 */
export function applyCloreRankedPriceGuard(ranked, override = {}) {
  const list = Array.isArray(ranked) ? ranked.slice() : [];
  const enabled =
    override.enabled != null ? Boolean(override.enabled) : CLORE_PRICE_GUARD.enabled !== false;
  if (!enabled || list.length === 0) {
    return { offers: list, dropped: 0, cheapestDaily: null, capDaily: null };
  }

  const multiples = list
    .map((r) => Number(r.pricePerHour))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (multiples.length === 0) {
    return { offers: list, dropped: 0, cheapestDaily: null, capDaily: null };
  }

  const cheapestHour = Math.min(...multiples);
  const cheapestDaily = cheapestHour * 24;
  const maxMult = Number(
    override.maxMultipleOfCheapest ?? CLORE_PRICE_GUARD.maxMultipleOfCheapest ?? 2,
  );
  const maxDailyAbs = Number(override.maxDailyUsd ?? CLORE_PRICE_GUARD.maxDailyUsd ?? 0);
  const relativeCapDaily =
    Number.isFinite(maxMult) && maxMult > 1 ? cheapestDaily * maxMult : Infinity;
  const absoluteCapDaily =
    Number.isFinite(maxDailyAbs) && maxDailyAbs > 0 ? maxDailyAbs : Infinity;
  const capDaily = Math.min(relativeCapDaily, absoluteCapDaily);

  const kept = list.filter((r) => {
    const daily = Number(r.pricePerHour) * 24;
    return Number.isFinite(daily) && daily > 0 && daily <= capDaily + 1e-9;
  });

  // Never empty the walk list entirely — fail-open to original ranked set.
  if (kept.length === 0) {
    return {
      offers: list,
      dropped: 0,
      cheapestDaily,
      capDaily: Number.isFinite(capDaily) ? capDaily : null,
    };
  }

  return {
    offers: kept,
    dropped: list.length - kept.length,
    cheapestDaily,
    capDaily: Number.isFinite(capDaily) ? capDaily : null,
  };
}
