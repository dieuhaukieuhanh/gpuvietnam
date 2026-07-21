/**
 * Vast L1 — percentile price band (no bottom-fishing).
 * Pure helpers; wired from filterVastOffersBySanity.
 */

import { VAST_PERCENTILE_BAND } from '../../gpu-config.js';

/**
 * @param {number[]} sortedAsc
 * @param {number} pct 0..1
 */
export function percentileSorted(sortedAsc, pct) {
  if (!sortedAsc.length) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const clamped = Math.min(1, Math.max(0, pct));
  const idx = (sortedAsc.length - 1) * clamped;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const w = idx - lo;
  return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
}

/**
 * @param {string | null | undefined} plan
 * @returns {'starter'|'pro'|'studio'}
 */
export function resolvePercentilePlanBucket(plan) {
  const p = String(plan ?? '')
    .trim()
    .toLowerCase();
  if (p.includes('studio')) return 'studio';
  if (p.includes('pro')) return 'pro';
  return 'starter';
}

/**
 * @param {import('../../offer-selection.js').NormalizedOffer[]} offers
 * @param {{ plan?: string | null; gpuLine?: string | null }} [context]
 * @returns {{
 *   offers: import('../../offer-selection.js').NormalizedOffer[];
 *   dropped: number;
 *   mode: string;
 *   low?: number;
 *   high?: number;
 * }}
 */
export function applyVastPercentilePriceBand(offers, context = {}) {
  const cfg = VAST_PERCENTILE_BAND;
  const list = Array.isArray(offers) ? offers.slice() : [];
  const n = list.length;
  if (n === 0) {
    return { offers: [], dropped: 0, mode: 'empty' };
  }

  // Temporary: skip band for all plans (Starter / Pro / Studio).
  if (cfg.enabled === false) {
    return { offers: list, dropped: 0, mode: 'disabled' };
  }

  const bucket = resolvePercentilePlanBucket(context.plan);
  const prices = list.map((o) => o.pricePerHour).filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length === 0) {
    return { offers: list, dropped: 0, mode: 'no_prices' };
  }
  prices.sort((a, b) => a - b);

  if (n < cfg.thinCohortMin) {
    return { offers: list, dropped: 0, mode: 'cohort_too_small' };
  }

  /** @type {import('../../offer-selection.js').NormalizedOffer[]} */
  let kept = list;
  let mode = '';
  let low;
  let high;

  if (bucket === 'starter') {
    if (n >= cfg.fullCohortMin) {
      const dropCount = Math.max(1, Math.floor(n * cfg.starter.fullDropBottomFraction));
      const sorted = list.slice().sort((a, b) => a.pricePerHour - b.pricePerHour);
      const cutoff = sorted[Math.min(dropCount, sorted.length - 1)]?.pricePerHour;
      low = cutoff;
      kept = list.filter((o) => o.pricePerHour >= cutoff);
      mode = `starter_drop_bottom_${dropCount}`;
    } else {
      const sorted = list.slice().sort((a, b) => a.pricePerHour - b.pricePerHour);
      const dropCount = Math.min(cfg.starter.thinDropCheapestCount, Math.max(0, n - 1));
      const dropIds = new Set(sorted.slice(0, dropCount).map((o) => o.offerId));
      kept = list.filter((o) => !dropIds.has(o.offerId));
      mode = `starter_thin_drop_${dropCount}`;
      low = sorted[dropCount]?.pricePerHour;
    }
  } else {
    const full = n >= cfg.fullCohortMin;
    const lowPct = full ? cfg.proStudio.fullLowPct : cfg.proStudio.thinLowPct;
    const highPct = full ? cfg.proStudio.fullHighPct : cfg.proStudio.thinHighPct;
    low = percentileSorted(prices, lowPct);
    high = percentileSorted(prices, highPct);
    kept = list.filter((o) => o.pricePerHour >= low && o.pricePerHour <= high);
    mode = full ? 'pro_studio_p40_p70' : 'pro_studio_p25_p85';
    if (kept.length === 0) {
      // Fail-open to pre-band list so we never empty the cohort entirely.
      kept = list;
      mode = `${mode}_fallback_all`;
    }
  }

  return {
    offers: kept,
    dropped: Math.max(0, n - kept.length),
    mode,
    low,
    high,
  };
}
