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
 * Clore-only routing:
 * - GPU_CLORE_ONLY=true → always
 * - Lifecycle worker (VPS) → Clore-only by default unless GPU_ALLOW_VAST=true
 *   (prevents silent Vast disk-only rents when env/CRLF drops the flag)
 */
export function isCloreOnlyMode() {
  if (isEnvFlagTrue('GPU_CLORE_ONLY')) return true;
  if (
    process.env.GPUVIETNAM_LIFECYCLE_WORKER === '1' &&
    !isEnvFlagTrue('GPU_ALLOW_VAST')
  ) {
    return true;
  }
  return false;
}

/**
 * Next provider in the Vast x4 -> Clore x1 rotation.
 * @returns {'clore'|'vast'}
 */
export function nextProviderInRotation() {
  const sequence = PROVIDER_ROUTING.sequence;
  const provider = sequence[routingCursor % sequence.length];
  routingCursor = (routingCursor + 1) % sequence.length;
  return provider;
}

/**
 * Failover partner for a provider id.
 * @param {'clore'|'vast'|string} providerId
 * @returns {'clore'|'vast'}
 */
export function failoverProvider(providerId) {
  return providerId === 'clore' ? 'vast' : 'clore';
}

/**
 * Ordered attempt list: Vast first, Clore failover (unless forced).
 * Clore is only eligible for 3090 / 4090 — never 5090/Studio.
 * Set GPU_CLORE_ONLY=true to force Clore-only on supported lines (journal / probe).
 * Set GPU_VAST_ONLY=true to disable Clore entirely (takes precedence over Clore-only /
 * lifecycle-worker default Clore-only).
 * @param {'clore'|'vast'|string | { forcedPrimary?: string; gpuLine?: string | null }} [forcedPrimaryOrOptions]
 * @param {{ gpuLine?: string | null }} [maybeOptions]
 * @returns {Array<'clore'|'vast'>}
 */
export function resolveProviderAttemptOrder(forcedPrimaryOrOptions, maybeOptions) {
  /** @type {'clore'|'vast'|string|undefined} */
  let forcedPrimary;
  /** @type {string | null | undefined} */
  let gpuLine;
  if (
    forcedPrimaryOrOptions &&
    typeof forcedPrimaryOrOptions === 'object' &&
    !Array.isArray(forcedPrimaryOrOptions)
  ) {
    forcedPrimary = forcedPrimaryOrOptions.forcedPrimary;
    gpuLine = forcedPrimaryOrOptions.gpuLine;
  } else {
    forcedPrimary = /** @type {string|undefined} */ (forcedPrimaryOrOptions);
    gpuLine = maybeOptions?.gpuLine;
  }

  const cloreAllowed = isCloreGpuLineSupported(gpuLine);

  /** @param {Array<'clore'|'vast'>} order */
  const filterOrder = (order) => {
    if (cloreAllowed) return order;
    const filtered = order.filter((p) => p !== 'clore');
    return filtered.length ? filtered : ['vast'];
  };

  // Explicit Vast-only probe wins over Clore-only / lifecycle default Clore-only.
  if (isEnvFlagTrue('GPU_VAST_ONLY')) {
    return ['vast'];
  }
  if (isCloreOnlyMode()) {
    if (!cloreAllowed) {
      logger('provider').warn(
        {
          operation: 'provider.routing',
          gpuLine: gpuLine != null ? String(gpuLine) : null,
          phase: 'SKIP',
        },
        'Clore-only ignored for unsupported Clore gpuLine; using Vast',
      );
      return ['vast'];
    }
    return ['clore'];
  }
  if (forcedPrimary === 'clore' || forcedPrimary === 'vast') {
    if (forcedPrimary === 'clore' && !cloreAllowed) {
      logger('provider').warn(
        {
          operation: 'provider.routing',
          gpuLine: gpuLine != null ? String(gpuLine) : null,
          phase: 'SKIP',
        },
        'forceProvider=clore ignored for unsupported Clore gpuLine; using Vast',
      );
      return ['vast'];
    }
    return filterOrder([forcedPrimary, failoverProvider(forcedPrimary)]);
  }
  // Vast primary — Clore HTTP proxy has been unreliable across hosts (journal).
  return filterOrder(['vast', 'clore']);
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
 *   attemptOrder?: Array<'clore'|'vast'>;
 *   gpuLine?: string | null;
 *   createWithProvider: (providerId: 'clore'|'vast') => Promise<T>;
 *   isConfigured?: (providerId: 'clore'|'vast') => boolean;
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