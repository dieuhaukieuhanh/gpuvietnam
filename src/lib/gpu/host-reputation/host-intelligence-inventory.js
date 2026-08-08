/**
 * Host Intelligence inventory for Admin UI.
 * Matches cron decision metric: available = known-good AND currently on marketplace.
 *
 * Vast and Clore are separate surfaces — Vast has live market probe + cron;
 * Clore book stats only until Clore cron is implemented.
 */

import { VastClient } from '../providers/vast/vast-client.js';
import { normalizeVastOffer } from '../offer-selection.js';
import { filterVastOffersBySanity } from '../providers/vast/vast-offer-sanity.js';
import {
  computeReliabilityScore,
  isHostBlacklisted,
  isHostInCooldown,
  isHostStale,
  isKnownGoodHost,
  listHostReputationRecords,
  loadHostReputationStoreAsync,
  resolveVastHostKey,
} from './index.js';

const GPU_LINES = ['rtx3090', 'rtx4090_1x', 'rtx5090_1x'];
const LINE_TO_PLAN = {
  rtx3090: 'starter',
  rtx4090_1x: 'pro',
  rtx5090_1x: 'studio',
};

/**
 * @param {{ provider?: string|null; hostKey?: string|null }} record
 * @param {'vast'|'clore'} provider
 */
export function matchesHostIntelligenceProvider(record, provider) {
  const p = String(record?.provider || '').trim().toLowerCase();
  if (p === provider) return true;
  const key = String(record?.hostKey || '');
  if (provider === 'vast') return key.startsWith('vast-host:');
  if (provider === 'clore') return key.startsWith('clore-host:');
  return false;
}

/**
 * Book / reliability stats for one provider (no marketplace probe).
 * @param {'vast'|'clore'} provider
 */
export function getHostIntelligenceBookSummaryForProvider(provider) {
  const records = listHostReputationRecords().filter((r) =>
    matchesHostIntelligenceProvider(r, provider),
  );
  const now = Date.now();

  let knownGood = 0;
  /** @type {Record<string, number>} */
  const knownGoodByLine = {};
  let stale = 0;
  let blacklisted = 0;
  let inCooldown = 0;
  let passRateSum = 0;
  let passRateCount = 0;

  for (const line of GPU_LINES) knownGoodByLine[line] = 0;

  for (const r of records) {
    if (isKnownGoodHost(r)) {
      knownGood += 1;
      const line = r.gpuLine || 'unknown';
      knownGoodByLine[line] = (knownGoodByLine[line] || 0) + 1;
    }
    if (isHostStale(r, now)) stale += 1;
    if (isHostBlacklisted(r, now)) blacklisted += 1;
    if (isHostInCooldown(r, now)) inCooldown += 1;

    const pr = Number(r.passRate);
    if (Number.isFinite(pr) && r.verificationCount && r.verificationCount > 0) {
      passRateSum += pr;
      passRateCount += 1;
    }
  }

  /** @type {Array<{ hostKey: string; reliabilityScore: number; gpuName: string | null; vramGb: number | null; passRate: number | null; avgBootSec: number | null }>} */
  const topHosts = [];
  for (const r of records) {
    const rs = computeReliabilityScore(r);
    if (rs != null) {
      topHosts.push({
        hostKey: r.hostKey,
        reliabilityScore: rs,
        gpuName: r.gpuName ?? null,
        vramGb: r.vramGb ?? null,
        passRate: r.passRate ?? null,
        avgBootSec: r.avgBootSec ?? null,
      });
    }
  }
  topHosts.sort((a, b) => b.reliabilityScore - a.reliabilityScore);

  return {
    provider,
    totalHosts: records.length,
    knownGood,
    knownGoodByLine,
    stale,
    blacklisted,
    inCooldown,
    averagePassRate: passRateCount > 0 ? Math.round(passRateSum / passRateCount) : null,
    topHosts: topHosts.slice(0, 10),
  };
}

/**
 * @param {VastClient} client
 * @param {string} gpuLine
 * @returns {Promise<string[]>}
 */
async function searchMarketHostKeys(client, gpuLine) {
  try {
    const plan = LINE_TO_PLAN[gpuLine] || 'starter';
    const rawOffers = await client.searchOffers(gpuLine);
    if (!rawOffers.length) return [];

    const normalized = [];
    for (const raw of rawOffers) {
      const offer = normalizeVastOffer(/** @type {Record<string, unknown>} */ (raw));
      if (offer) normalized.push(offer);
    }
    if (!normalized.length) return [];

    const { offers: saneOffers } = filterVastOffersBySanity(normalized, gpuLine, { plan });
    if (!saneOffers.length) return [];

    /** @type {string[]} */
    const keys = [];
    for (const offer of saneOffers) {
      const raw = offer.raw && typeof offer.raw === 'object'
        ? /** @type {Record<string, unknown>} */ (offer.raw)
        : null;
      if (!raw) continue;
      const hostKey = resolveVastHostKey(raw, gpuLine);
      if (hostKey) keys.push(hostKey);
    }
    return keys;
  } catch (err) {
    console.warn(
      `[host-intel] market probe failed for ${gpuLine}:`,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/**
 * Vast Admin summary — live marketplace ∩ known-good (cron metric).
 * @param {Record<string, number>} [targetPerLine]
 */
export async function getHostIntelligenceAdminSummary(targetPerLine = {}) {
  await loadHostReputationStoreAsync();
  const base = getHostIntelligenceBookSummaryForProvider('vast');

  /** @type {Record<string, number>} */
  const availableByLine = {};
  /** @type {Record<string, number>} */
  const marketCandidateCountByLine = {};
  for (const line of GPU_LINES) {
    availableByLine[line] = 0;
    marketCandidateCountByLine[line] = 0;
  }

  const vastClient = new VastClient();
  let marketProbe = 'ok';
  /** @type {Set<string>} */
  const marketKeys = new Set();

  if (!vastClient.apiKey) {
    marketProbe = 'skipped_no_vast_key';
  } else {
    for (const gpuLine of GPU_LINES) {
      const keys = await searchMarketHostKeys(vastClient, gpuLine);
      marketCandidateCountByLine[gpuLine] = keys.length;
      for (const key of keys) marketKeys.add(key);
    }
  }

  if (marketProbe === 'ok') {
    for (const r of listHostReputationRecords()) {
      if (!matchesHostIntelligenceProvider(r, 'vast')) continue;
      if (!isKnownGoodHost(r)) continue;
      if (!marketKeys.has(r.hostKey)) continue;
      const line = r.gpuLine || 'unknown';
      availableByLine[line] = (availableByLine[line] || 0) + 1;
    }
  }

  const availableTotal = Object.values(availableByLine).reduce((a, b) => a + b, 0);

  /** @type {Record<string, { available: number; inBook: number; target: number; ok: boolean }>} */
  const lines = {};
  for (const line of GPU_LINES) {
    const available = availableByLine[line] ?? 0;
    const inBook = base.knownGoodByLine?.[line] ?? 0;
    const target = Number(targetPerLine?.[line] ?? 4) || 0;
    lines[line] = {
      available,
      inBook,
      target,
      ok: available >= target,
    };
  }

  return {
    ...base,
    availableByLine,
    availableTotal,
    marketCandidateCountByLine,
    marketProbe,
    lines,
    probedAt: new Date().toISOString(),
  };
}

export { getHostIntelligenceCloreAdminSummary } from './host-intelligence-clore-inventory.js';