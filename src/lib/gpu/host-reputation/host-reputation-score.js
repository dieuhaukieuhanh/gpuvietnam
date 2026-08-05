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
 *   // ── Host Intelligence System ──
 *   gpuName?: string | null;
 *   vramGb?: number | null;
 *   driverVersion?: string | null;
 *   cudaVersion?: string | null;
 *   lastVerified?: number | null;
 *   verificationCount?: number;
 *   passRate?: number | null;
 *   avgBootSec?: number | null;
 *   avgLatencyMs?: number | null;
 *   benchmarkScore?: number | null;
 *   lastFailureAt?: number | null;
 *   cooldownUntil?: number | null;
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
    // ── Host Intelligence System fields ──
    gpuName: null,
    vramGb: null,
    driverVersion: null,
    cudaVersion: null,
    lastVerified: null,
    verificationCount: 0,
    passRate: null,
    avgBootSec: null,
    avgLatencyMs: null,
    benchmarkScore: null,
    lastFailureAt: null,
    cooldownUntil: null,
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

  // Cooldown before retry (badHostCooldownDays from config)
  const cooldownMs = HOST_REPUTATION.badHostCooldownDays * 24 * 60 * 60 * 1000;
  const cooldownUntil = cooldownMs > 0 ? now + cooldownMs : null;

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
      // Host Intelligence
      lastFailureAt: now,
      cooldownUntil: cooldownUntil || recovered.cooldownUntil || null,
      gpuName: recovered.gpuName ?? null,
      vramGb: recovered.vramGb ?? null,
      driverVersion: recovered.driverVersion ?? null,
      cudaVersion: recovered.cudaVersion ?? null,
      lastVerified: recovered.lastVerified ?? null,
      verificationCount: recovered.verificationCount ?? 0,
      passRate: recovered.passRate ?? null,
      avgBootSec: recovered.avgBootSec ?? null,
      avgLatencyMs: recovered.avgLatencyMs ?? null,
      benchmarkScore: recovered.benchmarkScore ?? null,
    },
    oldScore,
    newScore,
    blacklistUntil: blacklistUntil || null,
    penalty,
  };
}

/**
 * Reward only after customer-usable READY (not rent/order create).
 * Also records Host Intelligence metadata from gate verification.
 * @param {HostReputationRecord} record
 * @param {{
 *   now?: number;
 *   region?: string|null;
 *   gpuType?: string|null;
 *   gpuLine?: string|null;
 *   readyLatencyMs?: number|null;
 *   gpuName?: string|null;
 *   vramGb?: number|null;
 *   driverVersion?: string|null;
 *   cudaVersion?: string|null;
 *   bootSec?: number|null;
 *   benchmarkScore?: number|null;
 * }} [input]
 */
export function applyHostSuccess(record, input = {}) {
  const now = input.now ?? Date.now();
  const recovered = applyTimeRecovery(record, now).record;
  const oldScore = recovered.reputationScore;
  const latencyBonus = resolveLatencyBonus(input.readyLatencyMs);
  const newScore = clampScore(oldScore + HOST_REPUTATION.successDelta + latencyBonus);

  // Host Intelligence: rolling averages for boot time and latency
  const prevCount = Number(recovered.verificationCount || 0);
  const newCount = prevCount + 1;
  const prevAvgBoot = Number(recovered.avgBootSec || 0);
  const prevAvgLatency = Number(recovered.avgLatencyMs || 0);
  const curBoot = input.bootSec != null && Number.isFinite(Number(input.bootSec))
    ? Number(input.bootSec) : null;
  const curLatency = input.readyLatencyMs != null && Number.isFinite(Number(input.readyLatencyMs))
    ? Number(input.readyLatencyMs) : null;
  const newPassRate = prevCount > 0
    ? Math.round(((Number(recovered.passRate || 0) / 100) * prevCount + 1) / newCount * 10000) / 100
    : 100;
  const newAvgBoot = curBoot != null
    ? Number(((prevAvgBoot * prevCount + curBoot) / newCount).toFixed(1))
    : prevAvgBoot || null;
  const newAvgLatency = curLatency != null
    ? Number(((prevAvgLatency * prevCount + curLatency) / newCount).toFixed(1))
    : prevAvgLatency || null;

  return {
    record: {
      ...recovered,
      lastSeen: now,
      reputationScore: newScore,
      successCount: Number(recovered.successCount || 0) + 1,
      consecutiveFailures: 0,
      blacklistUntil: null,
      cooldownUntil: null,
      region: input.region ?? recovered.region,
      gpuType: input.gpuType ?? recovered.gpuType,
      gpuLine: input.gpuLine ?? recovered.gpuLine,
      lastReadyLatencyMs:
        curLatency != null ? curLatency : recovered.lastReadyLatencyMs ?? null,
      // Host Intelligence
      gpuName: input.gpuName ?? recovered.gpuName ?? null,
      vramGb: input.vramGb != null ? input.vramGb : recovered.vramGb ?? null,
      driverVersion: input.driverVersion ?? recovered.driverVersion ?? null,
      cudaVersion: input.cudaVersion ?? recovered.cudaVersion ?? null,
      lastVerified: now,
      verificationCount: newCount,
      passRate: newPassRate,
      avgBootSec: newAvgBoot,
      avgLatencyMs: newAvgLatency,
      benchmarkScore: input.benchmarkScore ?? recovered.benchmarkScore ?? null,
      lastFailureAt: recovered.lastFailureAt ?? null,
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

/**
 * Check if a host is in cooldown after a failure (not yet eligible for retry).
 * @param {HostReputationRecord | null | undefined} record
 * @param {number} [now]
 */
export function isHostInCooldown(record, now = Date.now()) {
  if (!record) return false;
  const until = Number(record.cooldownUntil || 0);
  return until > now;
}

/**
 * Check if a known-good host needs rechecking (lastVerified older than stale threshold).
 * @param {HostReputationRecord | null | undefined} record
 * @param {number} [now]
 * @returns {boolean}
 */
export function isHostStale(record, now = Date.now()) {
  if (!record) return false;
  const lastVerified = Number(record.lastVerified || 0);
  if (!lastVerified) return true; // never verified → stale
  return (now - lastVerified) > HOST_REPUTATION.staleThresholdMs;
}

/**
 * Compute a weighted reliability score (0-100) from Host Intelligence fields.
 *
 * Weights (configurable via env):
 *   40% provision pass rate
 *   20% boot time (faster = higher score)
 *   20% latency (lower = higher score)
 *   10% network (proxied by avgLatencyMs)
 *   10% unexpected stops (proxied by failureCount / total attempts)
 *
 * @param {HostReputationRecord | null | undefined} record
 * @returns {number | null} 0-100 or null if insufficient data
 */
export function computeReliabilityScore(record) {
  if (!record) return null;
  const total = (record.successCount || 0) + (record.failureCount || 0);
  if (total < 3) return null; // need minimum 3 verifications

  const w = HOST_REPUTATION.reliabilityWeights;

  // 1. Provision pass rate (0-100)
  const passRate = Number(record.passRate ?? 0);
  const provisionScore = Math.min(100, passRate);

  // 2. Boot time score (faster = higher, max 100 at ≤10s, 0 at ≥120s)
  const avgBoot = Number(record.avgBootSec || 0);
  const bootScore = avgBoot > 0
    ? Math.max(0, Math.min(100, 100 - ((avgBoot - 10) / (120 - 10)) * 100))
    : 50; // unknown → neutral

  // 3. Latency score (lower = higher, max 100 at ≤50ms, 0 at ≥1000ms)
  const avgLat = Number(record.avgLatencyMs || 0);
  const latencyScore = avgLat > 0
    ? Math.max(0, Math.min(100, 100 - ((avgLat - 50) / (1000 - 50)) * 100))
    : 50;

  // 4. Network proxy (use latency as approximation)
  const networkScore = latencyScore;

  // 5. Unexpected stops (failure rate)
  const failRate = total > 0 ? (record.failureCount || 0) / total : 0;
  const stopScore = Math.max(0, 100 - failRate * 100);

  const score =
    provisionScore * w.provisionPass +
    bootScore * w.bootTime +
    latencyScore * w.latency +
    networkScore * w.network +
    stopScore * w.unexpectedStop;

  return Math.round(Math.min(100, Math.max(0, score)));
}

/**
 * Host previously reached customer-usable READY at least N times.
 * @param {HostReputationRecord | null | undefined} record
 */
export function isKnownGoodHost(record) {
  if (!record) return false;
  const min = Math.max(1, Number(HOST_REPUTATION.knownGoodMinSuccessCount) || 1);
  return Number(record.successCount || 0) >= min;
}