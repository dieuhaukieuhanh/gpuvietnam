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
export { isHostBlacklisted, resolveLatencyBonus, applyTimeRecovery } from './host-reputation-score.js';
export { resetHostReputationStoreForTests } from './host-reputation-store.js';
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

  /** @type {Array<{ offer: T; hostKey: string|null; score: number; blacklisted: boolean; blacklistUntil: number }>} */
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
        reason: usedLeastBadFallback ? 'least_bad_fallback' : 'ranked',
        oldScore: row.score,
        newScore: row.score,
        offerId: row.offer.offerId,
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