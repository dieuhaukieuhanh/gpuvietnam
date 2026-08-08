/**
 * Level 1 - Provider routing (Vast primary, Clore secondary) with immediate failover.
 */

import {
  NO_AVAILABLE_WORKSTATION_MESSAGE,
  PROVIDER_ROUTING,
  isCloreGpuLineSupported,
} from './gpu-config.js';
import { GPUProviderError } from './gpu-errors.js';
import { logger, logPhase } from '../logging/index.js';
import {
  applyRetryDecision,
  decideRetryPolicy,
  shouldRetryAnotherProvider,
} from '../provider-retry-policy/index.js';
import {
  getProviderRoutingPolicySync,
  loadProviderRoutingPolicyAsync,
  isProviderEnabledInPolicy,
} from './provider-routing-policy.js';

/** @type {number} */
let routingCursor = 0;

/** True when env flag is set (tolerates CRLF / case / surrounding spaces / quotes). */
export function isEnvFlagTrue(name) {
  return String(process.env[name] ?? '')
    .replace(/\r/g, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim()
    .toLowerCase() === 'true';
}

/**
 * Emergency env overrides (ops break-glass).
 * Normal routing uses Admin `provider_routing_policy` (Hạ tầng tab).
 *
 * Priority when set: GPU_VAST_ONLY > GPU_CLORE_ONLY > GPU_SALAD_ONLY > Admin policy.
 */

/**
 * Salad-only routing (emergency env):
 * - GPU_SALAD_ONLY=true → always
 */
export function isSaladOnlyMode() {
  return isEnvFlagTrue('GPU_SALAD_ONLY');
}

/**
 * Clore-only routing (emergency env only).
 * Lifecycle-worker default Clore-only removed — Admin policy is SoT.
 */
export function isCloreOnlyMode() {
  if (isEnvFlagTrue('GPU_VAST_ONLY') || isEnvFlagTrue('GPU_SALAD_ONLY')) {
    return false;
  }
  return isEnvFlagTrue('GPU_CLORE_ONLY');
}

/** @returns {boolean} */
export function hasEmergencyProviderEnv() {
  return (
    isEnvFlagTrue('GPU_VAST_ONLY') ||
    isEnvFlagTrue('GPU_CLORE_ONLY') ||
    isEnvFlagTrue('GPU_SALAD_ONLY')
  );
}

/**
 * Next provider in the Salad → Vast x3 → Clore x1 rotation.
 * @returns {'clore'|'vast'|'salad'}
 */
export function nextProviderInRotation() {
  const sequence = PROVIDER_ROUTING.sequence;
  const provider = sequence[routingCursor % sequence.length];
  routingCursor = (routingCursor + 1) % sequence.length;
  return provider;
}

/**
 * Failover partner for a provider id.
 * Salad → Vast → Clore chain.
 * @param {'clore'|'vast'|'salad'|string} providerId
 * @returns {'clore'|'vast'|'salad'}
 */
export function failoverProvider(providerId) {
  if (providerId === 'salad') return 'vast';
  if (providerId === 'clore') return 'vast';
  return 'clore';
}

/**
 * Ordered attempt list for a NEW rent (Start / replace rent).
 *
 * 1) Emergency env (GPU_*_ONLY) if set
 * 2) Else Admin provider_routing_policy (enable + priority)
 * 3) Clore filtered when gpuLine not in CLORE_SUPPORTED_GPU_LINES
 *
 * Does not affect machines already running.
 *
 * @param {'clore'|'vast'|'salad'|string | { forcedPrimary?: string; gpuLine?: string | null; policy?: import('./provider-routing-policy.js').ProviderRoutingPolicy }} [forcedPrimaryOrOptions]
 * @param {{ gpuLine?: string | null }} [maybeOptions]
 * @returns {Array<'clore'|'vast'|'salad'>}
 */
export function resolveProviderAttemptOrder(forcedPrimaryOrOptions, maybeOptions) {
  /** @type {'clore'|'vast'|'salad'|string|undefined} */
  let forcedPrimary;
  /** @type {string | null | undefined} */
  let gpuLine;
  /** @type {import('./provider-routing-policy.js').ProviderRoutingPolicy | undefined} */
  let policyOverride;
  if (
    forcedPrimaryOrOptions &&
    typeof forcedPrimaryOrOptions === 'object' &&
    !Array.isArray(forcedPrimaryOrOptions)
  ) {
    forcedPrimary = forcedPrimaryOrOptions.forcedPrimary;
    gpuLine = forcedPrimaryOrOptions.gpuLine;
    policyOverride = forcedPrimaryOrOptions.policy;
  } else {
    forcedPrimary = /** @type {string|undefined} */ (forcedPrimaryOrOptions);
    gpuLine = maybeOptions?.gpuLine;
  }

  const cloreAllowed = isCloreGpuLineSupported(gpuLine);

  /** @param {Array<'clore'|'vast'|'salad'>} order */
  const dropUnsupportedClore = (order) => {
    if (cloreAllowed) return order;
    return order.filter((p) => p !== 'clore');
  };

  // ── Emergency env break-glass ──
  if (isEnvFlagTrue('GPU_SALAD_ONLY')) {
    return ['salad'];
  }
  if (isEnvFlagTrue('GPU_VAST_ONLY')) {
    return ['vast'];
  }
  if (isEnvFlagTrue('GPU_CLORE_ONLY')) {
    if (!cloreAllowed) {
      logger('provider').warn(
        {
          operation: 'provider.routing',
          gpuLine: gpuLine != null ? String(gpuLine) : null,
          phase: 'SKIP',
        },
        'GPU_CLORE_ONLY ignored for unsupported Clore gpuLine; using Vast',
      );
      return ['vast'];
    }
    return ['clore'];
  }

  // ── Admin policy SoT ──
  const policy = policyOverride ?? getProviderRoutingPolicySync();
  let order = policy.priority.filter((p) => isProviderEnabledInPolicy(policy, p));
  order = dropUnsupportedClore(order);

  if (forcedPrimary === 'clore' || forcedPrimary === 'vast' || forcedPrimary === 'salad') {
    if (forcedPrimary === 'clore' && !cloreAllowed) {
      logger('provider').warn(
        {
          operation: 'provider.routing',
          gpuLine: gpuLine != null ? String(gpuLine) : null,
          phase: 'SKIP',
        },
        'forceProvider=clore ignored for unsupported Clore gpuLine',
      );
    } else if (isProviderEnabledInPolicy(policy, forcedPrimary) || hasEmergencyProviderEnv()) {
      const rest = order.filter((p) => p !== forcedPrimary);
      order = dropUnsupportedClore([/** @type {'clore'|'vast'|'salad'} */ (forcedPrimary), ...rest]);
    }
  }

  if (order.length === 0) {
    logger('provider').warn(
      { operation: 'provider.routing', phase: 'EMPTY' },
      'No providers enabled in policy — falling back to Vast',
    );
    return ['vast'];
  }
  return order;
}

/**
 * Refresh policy cache then resolve (call at Start / new rent).
 * @param {{ forcedPrimary?: string; gpuLine?: string | null }} [options]
 * @returns {Promise<Array<'clore'|'vast'|'salad'>>}
 */
export async function resolveProviderAttemptOrderAsync(options = {}) {
  const policy = await loadProviderRoutingPolicyAsync();
  return resolveProviderAttemptOrder({
    forcedPrimary: options.forcedPrimary,
    gpuLine: options.gpuLine,
    policy,
  });
}

/**
 * @param {unknown} error
 * @param {{ provider?: string; retryCount?: number; requestId?: string|null }} [options]
 */
export function isProviderFailoverError(error, options = {}) {
  if (!error) return true;
  const decision = decideRetryPolicy({
    provider: options.provider || 'unknown',
    operation: 'provision',
    error,
    retryCount: options.retryCount ?? 0,
    requestId: options.requestId ?? null,
  });
  // AUTH / VALIDATION fail immediately — do not failover.
  if (decision.failImmediately) return false;
  return (
    shouldRetryAnotherProvider(decision) ||
    Boolean(decision.retryAnotherHost) ||
    Boolean(decision.refreshMarketplace) ||
    Boolean(decision.retry)
  );
}

/**
 * Run createWorkstation across providers with failover.
 * @template T
 * @param {{
 *   attemptOrder?: Array<'clore'|'vast'|'salad'>;
 *   gpuLine?: string | null;
 *   createWithProvider: (providerId: 'clore'|'vast'|'salad') => Promise<T>;
 *   isConfigured?: (providerId: 'clore'|'vast'|'salad') => boolean;
 * }} options
 * @returns {Promise<T>}
 */
export async function provisionWithProviderFailover(options) {
  const order =
    options.attemptOrder ?? resolveProviderAttemptOrder({ gpuLine: options.gpuLine });
  /** @type {Error | null} */
  let lastError = null;
  /** @type {Array<{ providerId: string; error: string }>} */
  const failures = [];
  const log = logger('provider');
  const started = Date.now();
  logPhase('provider.failover', 'START', {
    channel: 'provider',
    meta: { attemptOrder: order },
  });

  for (const providerId of order) {
    if (options.isConfigured && !options.isConfigured(providerId)) {
      log.warn(
        { operation: 'provider.failover', providerId, phase: 'SKIP' },
        `${providerId} not configured, skipping`,
      );
      failures.push({ providerId, error: 'not configured' });
      continue;
    }
    const attemptStarted = Date.now();
    try {
      log.info(
        { operation: 'provider.attempt', providerId, provider: providerId, phase: 'START' },
        `attempting provider=${providerId}`,
      );
      const result = await options.createWithProvider(providerId);
      const providerLatencyMs = Date.now() - attemptStarted;
      log.info(
        {
          operation: 'provider.attempt',
          providerId,
          provider: providerId,
          phase: 'SUCCESS',
          durationMs: providerLatencyMs,
          providerLatencyMs,
        },
        `provider=${providerId} succeeded`,
      );
      if (failures.length && result && typeof result === 'object') {
        /** @type {Record<string, unknown>} */ (result).gpuvietnam_failover = {
          won: providerId,
          failures,
        };
      }
      logPhase('provider.failover', 'SUCCESS', {
        channel: 'provider',
        durationMs: Date.now() - started,
        meta: { won: providerId, failures },
      });
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      failures.push({ providerId, error: lastError.message });
      const decision = decideRetryPolicy({
        provider: providerId,
        operation: 'provision',
        error: lastError,
        retryCount: failures.length - 1,
      });
      const canFailover = isProviderFailoverError(error, {
        provider: providerId,
        retryCount: failures.length - 1,
      });
      await applyRetryDecision(
        {
          ...decision,
          waitDurationMs: 0,
          retryAnotherProvider: canFailover,
          retryAnotherHost: false,
          progressTick: canFailover ? 'retry_provider_switch' : decision.progressTick,
          progressMessage: canFailover ? 'Trying another provider...' : decision.progressMessage,
          progressMessageVi: canFailover ? 'Dang chuyen provider...' : decision.progressMessageVi,
          decision: canFailover ? 'retry_another_provider' : decision.decision,
        },
        {
          provider: providerId,
          operation: 'provision',
          retryCount: failures.length - 1,
        },
      );
      log.warn(
        {
          operation: 'provider.attempt',
          providerId,
          provider: providerId,
          phase: 'FAILURE',
          providerLatencyMs: Date.now() - attemptStarted,
          err: { message: lastError.message },
          retryDecision: canFailover ? 'retry_another_provider' : decision.decision,
          category: decision.category,
        },
        `${providerId} failed, evaluating failover`,
      );
      if (!canFailover) {
        logPhase('provider.failover', 'FAILURE', {
          channel: 'provider',
          durationMs: Date.now() - started,
          err: lastError,
          meta: { failures },
        });
        throw lastError;
      }
    }
  }

  logPhase('provider.failover', 'FAILURE', {
    channel: 'provider',
    durationMs: Date.now() - started,
    err: lastError,
    meta: { failures },
  });
  // Clore-only: keep the real provider error (e.g. code 1 / 429) for diagnosis
  // instead of collapsing everything to the generic stock message.
  if (isCloreOnlyMode() && lastError) {
    throw lastError;
  }
  throw new GPUProviderError(NO_AVAILABLE_WORKSTATION_MESSAGE, {
    retryable: false,
    cause: lastError ?? undefined,
  });
}

/** Test helper */
export function resetProviderRoutingCursor(value = 0) {
  routingCursor = value;
}

export function getProviderRoutingCursor() {
  return routingCursor;
}