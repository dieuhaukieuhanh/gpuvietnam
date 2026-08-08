/**
 * Shared Host Reputation System for Clore + Vast offer selection.
 *
 * Success rewards are granted only after the machine is READY for customer use
 * (online + networking + ComfyUI healthy + workflow endpoint reachable).
 */

import { HOST_REPUTATION } from './host-reputation-config.js';
import { classifyHostFailure } from './host-reputation-classify.js';
import { parseHostKey } from './host-reputation-keys.js';
import { logHostReputationEvent } from './host-reputation-log.js';
import {
  getHostReputationMetrics,
  incrHostReputationMetric,
  recordHostFailureReason,
  recordHostScoreSample,
} from './host-reputation-metrics.js';
import {
  applyHostFailure,
  applyHostSuccess,
  createNeutralHostRecord,
  isHostBlacklisted,
  isKnownGoodHost,
  isHostStale,
  isHostInCooldown,
  computeReliabilityScore,
} from './host-reputation-score.js';
import {
  getHostReputationRecord,
  listHostReputationRecords,
  putHostReputationRecord,
  loadHostReputationStore,
} from './host-reputation-store.js';

export {
  HOST_REPUTATION,
  HOST_FAILURE_PENALTIES,
  HOST_BLACKLIST_CATEGORIES,
} from './host-reputation-config.js';
export { HOST_FAILURE_CATEGORY, classifyHostFailure } from './host-reputation-classify.js';
export {
  resolveVastHostKey,
  resolveCloreHostKey,
  parseHostKey,
  buildHostReputationKey,
  withGpuLine,
  normalizeGpuLine,
} from './host-reputation-keys.js';
export { getHostReputationMetrics } from './host-reputation-metrics.js';
export {
  isHostBlacklisted,
  isKnownGoodHost,
  resolveLatencyBonus,
  applyTimeRecovery,
} from './host-reputation-score.js';
export { resetHostReputationStoreForTests, loadHostReputationStoreAsync } from './host-reputation-store.js';
export { resetHostReputationMetrics } from './host-reputation-metrics.js';

/**
 * @param {string} hostKey
 * @param {{
 *   region?: string|null;
 *   gpuType?: string|null;
 *   gpuLine?: string|null;
 *   serverId?: string|null;
 *   now?: number;
 * }} [meta]
 */
function ensureRecord(hostKey, meta = {}) {
  const existing = getHostReputationRecord(hostKey, meta.now);
  if (existing) return existing;
  const parsed = parseHostKey(hostKey);
  if (!parsed) return null;
  return createNeutralHostRecord(hostKey, {
    provider: parsed.provider,
    hostId: parsed.hostId,
    serverId: meta.serverId ?? parsed.hostId,
    region: meta.region,
    gpuType: meta.gpuType ?? parsed.gpuLine,
    gpuLine: meta.gpuLine ?? parsed.gpuLine,
  }, meta.now);
}

/**
 * @param {string} hostKey
 * @param {number} [now]
 */
export function isHostExcludedByReputation(hostKey, now = Date.now()) {
  loadHostReputationStore();
  const record = getHostReputationRecord(hostKey, now);
  if (!record) return false;
  if (isHostBlacklisted(record, now)) return true;
  return false;
}

/**
 * @param {string} hostKey
 * @param {{
 *   error?: unknown;
 *   reason?: string;
 *   category?: string;
 *   phase?: string;
 *   region?: string|null;
 *   gpuType?: string|null;
 *   gpuLine?: string|null;
 *   requestId?: string|null;
 *   now?: number;
 * }} [meta]
 */
export function rememberHostFailure(hostKey, meta = {}) {
  const key = String(hostKey ?? '').trim();
  if (!key) return null;
  const category =
    meta.category ||
    classifyHostFailure(meta.error ?? meta.reason, { phase: meta.phase });
  const reason = meta.reason || (meta.error instanceof Error ? meta.error.message : String(meta.error ?? category));
  const before = ensureRecord(key, meta);
  if (!before) return null;
  const wasBlacklisted = isHostBlacklisted(before, meta.now);
  const result = applyHostFailure(before, {
    category,
    reason,
    now: meta.now,
    region: meta.region,
    gpuType: meta.gpuType,
    gpuLine: meta.gpuLine,
  });
  putHostReputationRecord(result.record);
  incrHostReputationMetric('hostFailureCount');
  recordHostFailureReason(category);
  recordHostScoreSample(result.newScore);

  logHostReputationEvent(
    'HOST_SCORE_UPDATED',
    {
      requestId: meta.requestId,
      provider: result.record.provider,
      hostId: result.record.hostId,
      serverId: result.record.serverId,
      gpuType: result.record.gpuType,
      gpuLine: result.record.gpuLine,
      reason,
      category,
      oldScore: result.oldScore,
      newScore: result.newScore,
      blacklistUntil: result.blacklistUntil
        ? new Date(result.blacklistUntil).toISOString()
        : null,
      consecutiveFailures: result.record.consecutiveFailures,
    },
    'Host reputation decreased after failure',
  );

  if (result.blacklistUntil && (!wasBlacklisted || result.blacklistUntil > Number(before.blacklistUntil || 0))) {
    incrHostReputationMetric('hostBlacklistCount');
    logHostReputationEvent(
      'HOST_BLACKLISTED',
      {
        requestId: meta.requestId,
        provider: result.record.provider,
        hostId: result.record.hostId,
        serverId: result.record.serverId,
        gpuType: result.record.gpuType,
        gpuLine: result.record.gpuLine,
        reason: category,
        oldScore: result.oldScore,
        newScore: result.newScore,
        blacklistUntil: new Date(result.blacklistUntil).toISOString(),
      },
      'Host temporarily blacklisted',
    );
  }
  return result.record;
}

/**
 * Reward host only after machine is READY for customer usage.
 * Do not call this on provider rent / order-create success alone.
 *
 * @param {string} hostKey
 * @param {{
 *   region?: string|null;
 *   gpuType?: string|null;
 *   gpuLine?: string|null;
 *   requestId?: string|null;
 *   readyLatencyMs?: number|null;
 *   now?: number;
 * }} [meta]
 */
export function rememberHostSuccess(hostKey, meta = {}) {
  const key = String(hostKey ?? '').trim();
  if (!key) return null;
  const before = ensureRecord(key, meta);
  if (!before) return null;
  const wasBlacklisted = isHostBlacklisted(before, meta.now);
  const result = applyHostSuccess(before, meta);
  putHostReputationRecord(result.record);
  incrHostReputationMetric('hostSuccessCount');
  recordHostScoreSample(result.newScore);

  const common = {
    requestId: meta.requestId,
    provider: result.record.provider,
    hostId: result.record.hostId,
    serverId: result.record.serverId,
    gpuType: result.record.gpuType,
    gpuLine: result.record.gpuLine ?? meta.gpuLine ?? null,
    readyLatencyMs: meta.readyLatencyMs ?? null,
    oldScore: result.oldScore,
    newScore: result.newScore,
    blacklistUntil: null,
  };

  logHostReputationEvent(
    'HOST_READY',
    {
      ...common,
      reason: 'machine_ready',
      latencyBonus: result.latencyBonus,
      consecutiveFailures: 0,
    },
    'Host earned reputation after machine READY',
  );

  if (result.latencyBonus > 0) {
    logHostReputationEvent(
      'HOST_LATENCY',
      {
        ...common,
        reason: 'ready_latency_bonus',
        latencyBonus: result.latencyBonus,
      },
      'Host received READY latency bonus',
    );
  }

  if (wasBlacklisted) {
    incrHostReputationMetric('hostRecoveryCount');
    logHostReputationEvent(
      'HOST_RECOVERED',
      {
        ...common,
        reason: 'ready_cleared_blacklist',
      },
      'Host blacklist cleared after READY',
    );
  }

  logHostReputationEvent(
    'HOST_SCORE_UPDATED',
    {
      ...common,
      reason: 'ready_success',
    },
    'Host reputation increased after READY',
  );
  return result.record;
}

/**
 * Pull previously-READY hosts from the wider marketplace pool into the shortlist.
 * Price/uptime truncation can drop known-good hosts before reputation ranking runs;
 * this puts them back so the walk tries them first.
 *
 * @template {{ offerId?: unknown }} T
 * @param {T[]} ranked Shortlist from price/uptime selection
 * @param {T[]} pool Broader filtered pool (pre-truncation)
 * @param {(offer: T) => string | null} resolveHostKey
 * @param {{ requestId?: string|null; now?: number; maxPins?: number }} [options]
 * @returns {{ offers: T[]; pinned: number }}
 */
export function mergeKnownGoodOffersIntoCandidates(ranked, pool, resolveHostKey, options = {}) {
  loadHostReputationStore();
  const now = options.now ?? Date.now();
  if (HOST_REPUTATION.knownGoodPinEnabled === false) {
    return { offers: Array.isArray(ranked) ? ranked.slice() : [], pinned: 0 };
  }

  const maxPins = Math.max(
    0,
    Math.floor(
      Number(options.maxPins) > 0
        ? Number(options.maxPins)
        : HOST_REPUTATION.knownGoodMaxPins || 3,
    ),
  );
  if (maxPins <= 0) {
    return { offers: Array.isArray(ranked) ? ranked.slice() : [], pinned: 0 };
  }

  /** @type {Set<string>} */
  const rankedKeys = new Set();
  for (const offer of ranked ?? []) {
    const key = resolveHostKey(offer);
    if (key) rankedKeys.add(key);
  }

  /** @type {Array<{ offer: T; hostKey: string; successCount: number; score: number; readyMs: number }>} */
  const pinCandidates = [];
  for (const offer of pool ?? []) {
    const hostKey = resolveHostKey(offer);
    if (!hostKey || rankedKeys.has(hostKey)) continue;
    const record = getHostReputationRecord(hostKey, now);
    if (!record || isHostBlacklisted(record, now) || !isKnownGoodHost(record)) continue;
    pinCandidates.push({
      offer,
      hostKey,
      successCount: Number(record.successCount || 0),
      score: Number(record.reputationScore || HOST_REPUTATION.neutralScore),
      readyMs:
        record.lastReadyLatencyMs != null && Number.isFinite(Number(record.lastReadyLatencyMs))
          ? Number(record.lastReadyLatencyMs)
          : Number.POSITIVE_INFINITY,
    });
  }

  pinCandidates.sort((a, b) => {
    if (b.successCount !== a.successCount) return b.successCount - a.successCount;
    if (a.readyMs !== b.readyMs) return a.readyMs - b.readyMs;
    return b.score - a.score;
  });

  const pins = pinCandidates.slice(0, maxPins);
  if (!pins.length) {
    return { offers: Array.isArray(ranked) ? ranked.slice() : [], pinned: 0 };
  }

  /** @type {Set<string>} */
  const pinKeys = new Set(pins.map((row) => row.hostKey));
  const rest = (ranked ?? []).filter((offer) => {
    const key = resolveHostKey(offer);
    return !key || !pinKeys.has(key);
  });

  for (const row of pins) {
    const parsed = parseHostKey(row.hostKey);
    logHostReputationEvent(
      'HOST_SELECTED',
      {
        requestId: options.requestId,
        provider: parsed?.provider,
        hostId: parsed?.hostId,
        gpuLine: parsed?.gpuLine,
        reason: 'known_good_pin',
        oldScore: row.score,
        newScore: row.score,
        offerId: row.offer.offerId,
        successCount: row.successCount,
        readyLatencyMs: Number.isFinite(row.readyMs) ? row.readyMs : null,
      },
      'Pinned previously-READY host into rent candidates',
    );
  }

  return {
    offers: [...pins.map((row) => row.offer), ...rest],
    pinned: pins.length,
  };
}

/**
 * Filter + re-rank normalized/ranked offers by reputation.
 *
 * @template {{ offerId?: unknown; raw?: Record<string, unknown>; region?: string; gpuType?: string; pricePerHour?: number; pingMs?: number; uptimePercent?: number; offer?: { raw?: Record<string, unknown>; region?: string; gpuType?: string } }} T
 * @param {T[]} offers
 * @param {(offer: T) => string | null} resolveHostKey
 * @param {{ requestId?: string|null; now?: number; allowLeastBadFallback?: boolean }} [options]
 * @returns {{ offers: T[]; droppedBlacklisted: number; usedLeastBadFallback: boolean }}
 */
export function applyHostReputationToOffers(offers, resolveHostKey, options = {}) {
  loadHostReputationStore();
  const now = options.now ?? Date.now();
  const allowFallback = options.allowLeastBadFallback !== false;

  /** @type {Array<{ offer: T; hostKey: string|null; score: number; blacklisted: boolean; blacklistUntil: number; knownGood: boolean; successCount: number; readyMs: number; reliabilityScore: number | null }>} */
  const annotated = [];
  let droppedBlacklisted = 0;

  for (const offer of offers) {
    const hostKey = resolveHostKey(offer);
    const record = hostKey ? getHostReputationRecord(hostKey, now) : null;
    const blacklisted = record ? isHostBlacklisted(record, now) : false;
    if (blacklisted) {
      droppedBlacklisted += 1;
      const parsed = hostKey ? parseHostKey(hostKey) : null;
      logHostReputationEvent(
        'HOST_SKIPPED',
        {
          requestId: options.requestId,
          provider: parsed?.provider,
          hostId: parsed?.hostId,
          serverId: record?.serverId,
          gpuType: record?.gpuType ?? offer.gpuType ?? offer.offer?.gpuType,
          gpuLine: parsed?.gpuLine ?? record?.gpuLine,
          reason: record?.lastFailureCategory ?? 'blacklisted',
          oldScore: record?.reputationScore,
          newScore: record?.reputationScore,
          blacklistUntil: record?.blacklistUntil
            ? new Date(record.blacklistUntil).toISOString()
            : null,
          offerId: offer.offerId,
        },
        'Skipping blacklisted host',
      );
    }
    annotated.push({
      offer,
      hostKey,
      score: record?.reputationScore ?? HOST_REPUTATION.neutralScore,
      blacklisted,
      blacklistUntil: Number(record?.blacklistUntil || 0),
      knownGood: isKnownGoodHost(record),
      successCount: Number(record?.successCount || 0),
      readyMs:
        record?.lastReadyLatencyMs != null && Number.isFinite(Number(record.lastReadyLatencyMs))
          ? Number(record.lastReadyLatencyMs)
          : Number.POSITIVE_INFINITY,
      reliabilityScore: computeReliabilityScore(record),
    });
  }

  let usable = annotated.filter((row) => !row.blacklisted);
  let usedLeastBadFallback = false;

  if (!usable.length && annotated.length && allowFallback) {
    usedLeastBadFallback = true;
    usable = annotated
      .slice()
      .sort((a, b) => {
        if (a.blacklistUntil !== b.blacklistUntil) return a.blacklistUntil - b.blacklistUntil;
        return b.score - a.score;
      })
      .slice(0, Math.min(3, annotated.length));
    logHostReputationEvent(
      'HOST_SELECTED',
      {
        requestId: options.requestId,
        reason: 'all_hosts_blacklisted_least_bad_fallback',
        count: usable.length,
      },
      'All hosts blacklisted — using least-bad fallback',
    );
  }

  usable.sort((a, b) => {
    // Previously-READY hosts first — shortens walk when the marketplace still lists them.
    if (a.knownGood !== b.knownGood) return a.knownGood ? -1 : 1;
    if (a.knownGood && b.knownGood) {
      if (b.successCount !== a.successCount) return b.successCount - a.successCount;
      if (a.readyMs !== b.readyMs) return a.readyMs - b.readyMs;
    }
    // Host Intelligence: prefer hosts with higher reliability scores
    const relA = a.reliabilityScore ?? 0;
    const relB = b.reliabilityScore ?? 0;
    if (relB !== relA) return relB - relA;
    if (b.score !== a.score) return b.score - a.score;
    const pingA = Number(a.offer.pingMs ?? a.offer.offer?.pingMs ?? 9999);
    const pingB = Number(b.offer.pingMs ?? b.offer.offer?.pingMs ?? 9999);
    if (pingA !== pingB) return pingA - pingB;
    const upA = Number(a.offer.uptimePercent ?? a.offer.offer?.uptimePercent ?? 0);
    const upB = Number(b.offer.uptimePercent ?? b.offer.offer?.uptimePercent ?? 0);
    if (upB !== upA) return upB - upA;
    const priceA = Number(a.offer.pricePerHour ?? a.offer.offer?.pricePerHour ?? 0);
    const priceB = Number(b.offer.pricePerHour ?? b.offer.offer?.pricePerHour ?? 0);
    return priceA - priceB;
  });

  for (const row of usable) {
    incrHostReputationMetric('hostSelectionCount');
    const parsed = row.hostKey ? parseHostKey(row.hostKey) : null;
    logHostReputationEvent(
      'HOST_SELECTED',
      {
        requestId: options.requestId,
        provider: parsed?.provider,
        hostId: parsed?.hostId,
        gpuType: row.offer.gpuType ?? row.offer.offer?.gpuType,
        gpuLine: parsed?.gpuLine,
        reason: usedLeastBadFallback
          ? 'least_bad_fallback'
          : row.knownGood
            ? 'known_good_ranked'
            : 'ranked',
        oldScore: row.score,
        newScore: row.score,
        offerId: row.offer.offerId,
        successCount: row.successCount,
      },
      'Host selected for provision candidate list',
    );
  }

  for (const record of listHostReputationRecords()) {
    if (record.blacklistUntil && record.blacklistUntil <= now) {
      logHostReputationEvent(
        'HOST_BLACKLIST_EXPIRED',
        {
          provider: record.provider,
          hostId: record.hostId,
          serverId: record.serverId,
          gpuType: record.gpuType,
          gpuLine: record.gpuLine,
          reason: 'ttl_elapsed',
          oldScore: record.reputationScore,
          newScore: record.reputationScore,
          blacklistUntil: null,
        },
        'Host blacklist expired',
      );
      putHostReputationRecord({ ...record, blacklistUntil: null });
    }
  }

  return {
    offers: usable.map((row) => row.offer),
    droppedBlacklisted,
    usedLeastBadFallback,
  };
}

export { getHostReputationMetrics as getHostReputationSnapshot };

// ──────────────────────────────────────────────────────────────────────
// Host Intelligence System — cron-driven discovery helpers
// ──────────────────────────────────────────────────────────────────────

// Re-export from host-reputation-score.js (already imported above)
export { isHostStale, isHostInCooldown, computeReliabilityScore };

/**
 * Get hosts that need rechecking (known-good but stale: lastVerified > 24h).
 * @param {number} [now]
 * @returns {Array<import('./host-reputation-score').HostReputationRecord>}
 */
export function getHostsNeedingRecheck(now = Date.now()) {
  loadHostReputationStore();
  const records = listHostReputationRecords();
  return records.filter((r) => {
    if (!isKnownGoodHost(r)) return false;
    return isHostStale(r, now);
  }).sort((a, b) => {
    // Prioritize: longest since last verification first
    const aLast = Number(a.lastVerified || 0);
    const bLast = Number(b.lastVerified || 0);
    return aLast - bLast;
  });
}

/**
 * Get failed hosts whose cooldown has expired and are eligible for retry.
 * @param {number} [now]
 * @returns {Array<import('./host-reputation-score').HostReputationRecord>}
 */
export function getHostsInCooldownDone(now = Date.now()) {
  loadHostReputationStore();
  const records = listHostReputationRecords();
  return records.filter((r) => {
    const cd = Number(r.cooldownUntil || 0);
    if (!cd) return false;
    return cd <= now && !isHostBlacklisted(r, now);
  }).sort((a, b) => {
    // Prioritize: highest previous success count first (was good before failing)
    const aSuccess = Number(a.successCount || 0);
    const bSuccess = Number(b.successCount || 0);
    return bSuccess - aSuccess;
  });
}

/**
 * Check if a host has never been seen before by looking up its record.
 * @param {string} hostKey
 * @returns {boolean}
 */
export function isHostUnseen(hostKey) {
  loadHostReputationStore();
  const record = getHostReputationRecord(hostKey);
  return !record;
}

/**
 * Get summary stats for the Host Intelligence System dashboard.
 * @returns {{
 *   totalHosts: number;
 *   knownGood: number;
 *   knownGoodByLine: Record<string, number>;
 *   stale: number;
 *   blacklisted: number;
 *   inCooldown: number;
 *   averagePassRate: number | null;
 *   topHosts: Array<{ hostKey: string; reliabilityScore: number; gpuName: string | null; vramGb: number | null; passRate: number | null; avgBootSec: number | null }>;
 * }}
 */
export function getHostIntelligenceSummary() {
  loadHostReputationStore();
  const records = listHostReputationRecords();
  const now = Date.now();

  let knownGood = 0;
  /** @type {Record<string, number>} */
  const knownGoodByLine = {};
  let stale = 0;
  let blacklisted = 0;
  let inCooldown = 0;
  let passRateSum = 0;
  let passRateCount = 0;

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
  const top10 = topHosts.slice(0, 10);

  return {
    totalHosts: records.length,
    knownGood,
    knownGoodByLine,
    stale,
    blacklisted,
    inCooldown,
    averagePassRate: passRateCount > 0 ? Math.round(passRateSum / passRateCount) : null,
    topHosts: top10,
  };
}