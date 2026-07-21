/**
 * Pure reputation scoring + blacklist duration helpers.
 */

import {
  HOST_BLACKLIST_CATEGORIES,
  HOST_FAILURE_PENALTIES,
  HOST_REPUTATION,
} from './host-reputation-config.js';

/**
 * @typedef {{
 *   provider: string;
 *   hostId: string;
 *   hostKey: string;
 *   serverId?: string | null;
 *   region?: string | null;
 *   gpuType?: string | null;
 *   gpuLine?: string | null;
 *   lastSeen: number;
 *   reputationScore: number;
 *   failureCount: number;
 *   successCount: number;
 *   lastFailureReason?: string | null;
 *   lastFailureCategory?: string | null;
 *   blacklistUntil: number | null;
 *   consecutiveFailures: number;
 *   lastReadyLatencyMs?: number | null;
 * }} HostReputationRecord
 */

/**
 * @param {string} hostKey
 * @param {{ provider: string; hostId: string; region?: string|null; gpuType?: string|null; gpuLine?: string|null; serverId?: string|null }} identity
 * @param {number} [now]
 * @returns {HostReputationRecord}
 */
export function createNeutralHostRecord(hostKey, identity, now = Date.now()) {
  return {
    provider: identity.provider,
    hostId: identity.hostId,
    hostKey,
    serverId: identity.serverId ?? identity.hostId,
    region: identity.region ?? null,
    gpuType: identity.gpuType ?? identity.gpuLine ?? null,
    gpuLine: identity.gpuLine ?? null,
    lastSeen: now,
    reputationScore: HOST_REPUTATION.neutralScore,
    failureCount: 0,
    successCount: 0,
    lastFailureReason: null,
    lastFailureCategory: null,
    blacklistUntil: null,
    consecutiveFailures: 0,
    lastReadyLatencyMs: null,
  };
}

/**
 * Asymptotic recovery toward neutral based on idle time since lastSeen.
 * score' = neutral + (score - neutral) * e^(-lambda * hours)
 *
 * @param {HostReputationRecord} record
 * @param {number} [now]
 * @returns {{ record: HostReputationRecord; recovered: boolean; oldScore: number; newScore: number }}
 */
export function applyTimeRecovery(record, now = Date.now()) {
  const idleMs = Math.max(0, now - Number(record.lastSeen || now));
  const hours = idleMs / (60 * 60 * 1000);
  const oldScore = Number(record.reputationScore);
  const neutral = HOST_REPUTATION.neutralScore;
  const lambda = Number(HOST_REPUTATION.recoveryLambdaPerHour) || 0;

  if (!(hours > 0) || !(lambda > 0) || oldScore === neutral) {
    return { record, recovered: false, oldScore, newScore: oldScore };
  }

  const gap = oldScore - neutral;
  const newScore = clampScore(neutral + gap * Math.exp(-lambda * hours));
  const recovered = newScore !== oldScore;
  return {
    record: {
      ...record,
      reputationScore: newScore,
    },
    recovered,
    oldScore,
    newScore,
  };
}

/**
 * Small READY latency bonus. Reliability remains primary; bonus is capped.
 * @param {number | null | undefined} readyLatencyMs
 * @returns {number}
 */
export function resolveLatencyBonus(readyLatencyMs) {
  const ms = Number(readyLatencyMs);
  if (!Number.isFinite(ms) || ms < 0) return 0;
  if (ms >= HOST_REPUTATION.latencyNoBonusMs) return 0;
  if (ms < HOST_REPUTATION.latencyFastMs) return HOST_REPUTATION.latencyBonusFast;
  return HOST_REPUTATION.latencyBonusMedium;
}

/**
 * @param {number} score
 */
export function clampScore(score) {
  return Math.max(
    HOST_REPUTATION.minScore,
    Math.min(HOST_REPUTATION.maxScore, Math.round(score * 10) / 10),
  );
}

/**
 * @param {string} category
 * @param {number} consecutiveFailures
 */
export function resolveBlacklistDurationMs(category, consecutiveFailures) {
  const hasKey = Object.prototype.hasOwnProperty.call(HOST_BLACKLIST_CATEGORIES, category);
  const severity = hasKey ? HOST_BLACKLIST_CATEGORIES[category] : 'minor';
  if (!severity) return 0;
  if (consecutiveFailures >= 2 || severity === 'critical') {
    if (severity === 'critical' || consecutiveFailures >= 3) {
      return HOST_REPUTATION.blacklistCriticalMs;
    }
    return HOST_REPUTATION.blacklistRepeatedMs;
  }
  if (severity === 'minor') return HOST_REPUTATION.blacklistMinorMs;
  return HOST_REPUTATION.blacklistRepeatedMs;
}

/**
 * @param {HostReputationRecord} record
 * @param {{ category: string; reason?: string; now?: number; region?: string|null; gpuType?: string|null; gpuLine?: string|null }} input
 */
export function applyHostFailure(record, input) {
  const now = input.now ?? Date.now();
  const recovered = applyTimeRecovery(record, now).record;
  const category = String(input.category || 'UNKNOWN');
  const basePenalty = HOST_FAILURE_PENALTIES[category] ?? HOST_FAILURE_PENALTIES.UNKNOWN;
  const consecutive = Number(recovered.consecutiveFailures || 0) + 1;
  const multiplier = Math.min(1 + (consecutive - 1) * 0.5, 3);
  const penalty = basePenalty * multiplier;
  const oldScore = recovered.reputationScore;
  const newScore = clampScore(oldScore - penalty);
  const blacklistMs = resolveBlacklistDurationMs(category, consecutive);
  const existingBlacklist = Number(recovered.blacklistUntil || 0);
  const blacklistUntil =
    blacklistMs > 0 ? Math.max(existingBlacklist, now + blacklistMs) : recovered.blacklistUntil;

  return {
    record: {
      ...recovered,
      lastSeen: now,
      reputationScore: newScore,
      failureCount: Number(recovered.failureCount || 0) + 1,
      consecutiveFailures: consecutive,
      lastFailureReason: input.reason ?? category,
      lastFailureCategory: category,
      blacklistUntil: blacklistUntil || null,
      region: input.region ?? recovered.region,
      gpuType: input.gpuType ?? recovered.gpuType,
      gpuLine: input.gpuLine ?? recovered.gpuLine,
    },
    oldScore,
    newScore,
    blacklistUntil: blacklistUntil || null,
    penalty,
  };
}

/**
 * Reward only after customer-usable READY (not rent/order create).
 * @param {HostReputationRecord} record
 * @param {{ now?: number; region?: string|null; gpuType?: string|null; gpuLine?: string|null; readyLatencyMs?: number|null }} [input]
 */
export function applyHostSuccess(record, input = {}) {
  const now = input.now ?? Date.now();
  const recovered = applyTimeRecovery(record, now).record;
  const oldScore = recovered.reputationScore;
  const latencyBonus = resolveLatencyBonus(input.readyLatencyMs);
  const newScore = clampScore(oldScore + HOST_REPUTATION.successDelta + latencyBonus);
  return {
    record: {
      ...recovered,
      lastSeen: now,
      reputationScore: newScore,
      successCount: Number(recovered.successCount || 0) + 1,
      consecutiveFailures: 0,
      blacklistUntil: null,
      region: input.region ?? recovered.region,
      gpuType: input.gpuType ?? recovered.gpuType,
      gpuLine: input.gpuLine ?? recovered.gpuLine,
      lastReadyLatencyMs:
        input.readyLatencyMs != null && Number.isFinite(Number(input.readyLatencyMs))
          ? Number(input.readyLatencyMs)
          : recovered.lastReadyLatencyMs ?? null,
    },
    oldScore,
    newScore,
    latencyBonus,
  };
}

/**
 * @param {HostReputationRecord | null | undefined} record
 * @param {number} [now]
 */
export function isHostBlacklisted(record, now = Date.now()) {
  if (!record) return false;
  const until = Number(record.blacklistUntil || 0);
  return until > now;
}