/**
 * Host reputation configuration (multi-provider).
 */

function envMs(name, fallback) {
  const raw = Number(process.env[name] ?? fallback);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function envNum(name, fallback) {
  const raw = Number(process.env[name] ?? fallback);
  return Number.isFinite(raw) ? raw : fallback;
}

export const HOST_REPUTATION = {
  /** Neutral starting score. */
  neutralScore: envNum('HOST_REP_NEUTRAL_SCORE', 50),
  minScore: envNum('HOST_REP_MIN_SCORE', 0),
  maxScore: envNum('HOST_REP_MAX_SCORE', 100),
  /** Points added when machine reaches READY (customer-usable). */
  successDelta: envNum('HOST_REP_SUCCESS_DELTA', 10),
  /**
   * Exponential recovery rate toward neutral (per idle hour).
   * score' = neutral + (score - neutral) * e^(-lambda * hours)
   * Default 0.4 ≈ 20→30→37→42→45→47→48→49→50
   */
  recoveryLambdaPerHour: envNum('HOST_REP_RECOVERY_LAMBDA', 0.4),
  /** @deprecated linear recovery; kept for env compat, unused when lambda > 0 */
  recoveryPerHour: envNum('HOST_REP_RECOVERY_PER_HOUR', 2),
  /** READY latency bonus thresholds */
  latencyFastMs: envMs('HOST_REP_LATENCY_FAST_MS', 60 * 1000),
  latencyNoBonusMs: envMs('HOST_REP_LATENCY_NO_BONUS_MS', 5 * 60 * 1000),
  latencyBonusFast: envNum('HOST_REP_LATENCY_BONUS_FAST', 2),
  latencyBonusMedium: envNum('HOST_REP_LATENCY_BONUS_MEDIUM', 1),
  /** Blacklist durations (ms). */
  blacklistMinorMs: envMs('HOST_REP_BLACKLIST_MINOR_MS', 15 * 60 * 1000),
  blacklistRepeatedMs: envMs('HOST_REP_BLACKLIST_REPEATED_MS', 30 * 60 * 1000),
  blacklistCriticalMs: envMs('HOST_REP_BLACKLIST_CRITICAL_MS', 60 * 60 * 1000),
  /** Persist path (relative to cwd). */
  storeFile: process.env.HOST_REP_STORE_FILE || 'tmp/host-reputation.json',
  /** Drop records older than this with no activity. */
  pruneAfterMs: envMs('HOST_REP_PRUNE_AFTER_MS', 14 * 24 * 60 * 60 * 1000),
  /**
   * Prefer hosts that previously reached READY when building the rent walk.
   * Pinning pulls them back into the candidate list even if price/uptime
   * truncation would have dropped them from the shortlist.
   */
  knownGoodPinEnabled: String(process.env.HOST_REP_KNOWN_GOOD_PIN ?? 'true')
    .trim()
    .toLowerCase() !== 'false',
  knownGoodMinSuccessCount: envNum('HOST_REP_KNOWN_GOOD_MIN_SUCCESS', 1),
  knownGoodMaxPins: envNum('HOST_REP_KNOWN_GOOD_MAX_PINS', 3),
};

/** Failure category → base score penalty (positive number subtracted). */
export const HOST_FAILURE_PENALTIES = {
  CURRENCY: 2,
  RATE_LIMIT: 3,
  NETWORK: 8,
  UNKNOWN: 10,
  // Opaque Clore code-1 is often platform-wide, not a durable host fault.
  PROVIDER_INTERNAL: 5,
  ENDPOINT_FAILURE: 18,
  IMAGE_PULL_FAILURE: 20,
  HEALTH_FAILURE: 25,
};

/** Categories that trigger temporary blacklist severity. */
export const HOST_BLACKLIST_CATEGORIES = {
  CURRENCY: null,
  RATE_LIMIT: 'minor',
  NETWORK: 'minor',
  UNKNOWN: 'minor',
  // Do not blacklist on code-1 storms — they poison the ≥99% pool for an hour.
  PROVIDER_INTERNAL: null,
  ENDPOINT_FAILURE: 'critical',
  IMAGE_PULL_FAILURE: 'critical',
  HEALTH_FAILURE: 'critical',
};