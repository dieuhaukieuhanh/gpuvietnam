/**
 * Drop outlier-expensive Clore ranked offers before the rent walk.
 *
 * Absolute maxDailyUsd is hard — never fail-open above it (empty list → start fails).
 * Relative 2×-cheapest may fail-open only within the absolute-safe set.
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
 *   hardEmpty: boolean;
 * }}
 */
export function applyCloreRankedPriceGuard(ranked, override = {}) {
  const list = Array.isArray(ranked) ? ranked.slice() : [];
  const enabled =
    override.enabled != null ? Boolean(override.enabled) : CLORE_PRICE_GUARD.enabled !== false;
  if (!enabled || list.length === 0) {
    return {
      offers: list,
      dropped: 0,
      cheapestDaily: null,
      capDaily: null,
      hardEmpty: false,
    };
  }

  const maxMult = Number(
    override.maxMultipleOfCheapest ?? CLORE_PRICE_GUARD.maxMultipleOfCheapest ?? 2,
  );
  const maxDailyAbs = Number(override.maxDailyUsd ?? CLORE_PRICE_GUARD.maxDailyUsd ?? 0);
  const absoluteCapDaily =
    Number.isFinite(maxDailyAbs) && maxDailyAbs > 0 ? maxDailyAbs : Infinity;

  const underAbsolute = list.filter((r) => {
    const daily = Number(r.pricePerHour) * 24;
    if (!(Number.isFinite(daily) && daily > 0)) return false;
    if (!Number.isFinite(absoluteCapDaily) || absoluteCapDaily === Infinity) return true;
    return daily <= absoluteCapDaily + 1e-9;
  });

  if (underAbsolute.length === 0) {
    const multiples = list
      .map((r) => Number(r.pricePerHour))
      .filter((n) => Number.isFinite(n) && n > 0);
    const cheapestDaily =
      multiples.length > 0 ? Math.min(...multiples) * 24 : null;
    return {
      offers: [],
      dropped: list.length,
      cheapestDaily,
      capDaily: Number.isFinite(absoluteCapDaily) ? absoluteCapDaily : null,
      hardEmpty: true,
    };
  }

  const cheapestHour = Math.min(
    ...underAbsolute.map((r) => Number(r.pricePerHour)).filter((n) => Number.isFinite(n) && n > 0),
  );
  const cheapestDaily = cheapestHour * 24;
  const relativeCapDaily =
    Number.isFinite(maxMult) && maxMult > 1 ? cheapestDaily * maxMult : Infinity;
  const capDaily = Math.min(relativeCapDaily, absoluteCapDaily);

  const kept = underAbsolute.filter((r) => {
    const daily = Number(r.pricePerHour) * 24;
    return Number.isFinite(daily) && daily > 0 && daily <= capDaily + 1e-9;
  });

  // Relative band may empty the shortlist — reopen only hosts already under absolute cap.
  if (kept.length === 0) {
    return {
      offers: underAbsolute,
      dropped: list.length - underAbsolute.length,
      cheapestDaily,
      capDaily: Number.isFinite(capDaily) ? capDaily : null,
      hardEmpty: false,
    };
  }

  return {
    offers: kept,
    dropped: list.length - kept.length,
    cheapestDaily,
    capDaily: Number.isFinite(capDaily) ? capDaily : null,
    hardEmpty: false,
  };
}
