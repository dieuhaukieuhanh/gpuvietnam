/**
 * Host reputation configuration (multi-provider).
 */

import fs from 'fs';
import path from 'path';

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

  // ── Host Intelligence System ──────────────────────────────────────────
  /** Hosts with lastVerified older than this need recheck (ms). Default 24h. */
  staleThresholdMs: envMs('HOST_REP_STALE_THRESHOLD_MS', 24 * 60 * 60 * 1000),
  /** Days before a failed host becomes eligible for retry. */
  badHostCooldownDays: envNum('HOST_REP_BAD_HOST_COOLDOWN_DAYS', 3),
  /** Max hosts to test per cron cycle. */
  maxTestPerCycle: envNum('HOST_REP_MAX_TEST_PER_CYCLE', 2),
  /** Min known-good hosts per GPU line to maintain (pool target). */
  targetKnownGoodPerLine: envNum('HOST_REP_TARGET_KNOWN_GOOD_PER_LINE', 4),
  /** When pool is below target, test up to this many hosts per cycle. */
  maxTestWhenBelowTarget: envNum('HOST_REP_MAX_TEST_BELOW_TARGET', 4),
  /** Sample fraction of stale known-good hosts to recheck per cycle. */
  staleSampleFraction: envNum('HOST_REP_STALE_SAMPLE_FRACTION', 0.1),
  /** Timeout for test-image provision gate (ms). Much shorter than full gate. */
  testGateTimeoutMs: envMs('HOST_REP_TEST_GATE_TIMEOUT_MS', 90_000),

  // ── Reliability Score weights (sum = 1.0) ────────────────────────────
  reliabilityWeights: {
    provisionPass: envNum('HOST_REP_RELIABILITY_W_PROVISION', 0.40),
    bootTime: envNum('HOST_REP_RELIABILITY_W_BOOT', 0.20),
    latency: envNum('HOST_REP_RELIABILITY_W_LATENCY', 0.20),
    network: envNum('HOST_REP_RELIABILITY_W_NETWORK', 0.10),
    unexpectedStop: envNum('HOST_REP_RELIABILITY_W_STOP', 0.10),
  },
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

// ---------------------------------------------------------------------------
// Runtime config (overridable via admin UI → Supabase, fallback JSON file)
// ---------------------------------------------------------------------------

export const HOST_INTELLIGENCE_CONFIG_PATH = path.resolve(
  process.env.HOST_INTEL_CONFIG_PATH || 'tmp/host-intelligence-config.json',
);

const DEFAULT_RUNTIME_CONFIG = {
  enabled: true,
  targetPerLine: { rtx3090: 4, rtx4090_1x: 4, rtx5090_1x: 4 },
  providers: { vast: true, clore: false },
};

// ── Supabase client (lazy) ────────────────────────────────────────────────
let _supabaseAdminConfig = null;

function getSupabaseAdminForConfig() {
  if (_supabaseAdminConfig) return _supabaseAdminConfig;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    _supabaseAdminConfig = createClient(url, key, { auth: { persistSession: false } });
    return _supabaseAdminConfig;
  } catch {
    return null;
  }
}

/**
 * Read runtime config — Supabase first, fallback JSON file, fallback defaults.
 * @returns {{ enabled: boolean; targetPerLine: Record<string, number>; providers: Record<string, boolean> }}
 */
export function readHostIntelligenceConfig() {
  // 1. Try JSON file (sync, always available as fallback)
  try {
    if (fs.existsSync(HOST_INTELLIGENCE_CONFIG_PATH)) {
      const raw = fs.readFileSync(HOST_INTELLIGENCE_CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_RUNTIME_CONFIG,
        ...parsed,
        targetPerLine: { ...DEFAULT_RUNTIME_CONFIG.targetPerLine, ...(parsed.targetPerLine ?? {}) },
        providers: { ...DEFAULT_RUNTIME_CONFIG.providers, ...(parsed.providers ?? {}) },
      };
    }
  } catch (err) {
    console.warn('[host-intel] Failed to read JSON config:', err instanceof Error ? err.message : String(err));
  }

  return { ...DEFAULT_RUNTIME_CONFIG, targetPerLine: { ...DEFAULT_RUNTIME_CONFIG.targetPerLine }, providers: { ...DEFAULT_RUNTIME_CONFIG.providers } };
}

/**
 * Async version — reads from Supabase first, then JSON fallback.
 * @returns {Promise<{ enabled: boolean; targetPerLine: Record<string, number>; providers: Record<string, boolean> }>}
 */
export async function readHostIntelligenceConfigAsync() {
  const admin = getSupabaseAdminForConfig();
  if (admin) {
    try {
      const { data, error } = await admin.from('host_intelligence_config').select('*').eq('id', 1).single();
      if (!error && data) {
        return {
          enabled: data.enabled ?? DEFAULT_RUNTIME_CONFIG.enabled,
          targetPerLine: {
            ...DEFAULT_RUNTIME_CONFIG.targetPerLine,
            ...(typeof data.target_per_line === 'object' ? data.target_per_line : {}),
          },
          providers: {
            ...DEFAULT_RUNTIME_CONFIG.providers,
            ...(typeof data.providers === 'object' ? data.providers : {}),
          },
        };
      }
    } catch (err) {
      console.warn('[host-intel] Supabase read error:', err instanceof Error ? err.message : String(err));
    }
  }
  return readHostIntelligenceConfig();
}

/**
 * Write runtime config to Supabase + JSON fallback.
 * @param {{ enabled: boolean; targetPerLine: Record<string, number>; providers: Record<string, boolean> }} config
 */
export async function writeHostIntelligenceConfigAsync(config) {
  // 1. Write to Supabase
  const admin = getSupabaseAdminForConfig();
  if (admin) {
    try {
      await admin.from('host_intelligence_config').upsert({
        id: 1,
        enabled: config.enabled,
        target_per_line: config.targetPerLine,
        providers: config.providers,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch (err) {
      console.warn('[host-intel] Supabase write error:', err instanceof Error ? err.message : String(err));
    }
  }
  // 2. JSON fallback
  writeHostIntelligenceConfig(config);
}

/**
 * Write runtime config as JSON only (sync, for backward compat).
 * @param {{ enabled: boolean; targetPerLine: Record<string, number>; providers: Record<string, boolean> }} config
 */
export function writeHostIntelligenceConfig(config) {
  const dir = path.dirname(HOST_INTELLIGENCE_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = HOST_INTELLIGENCE_CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, HOST_INTELLIGENCE_CONFIG_PATH);
}