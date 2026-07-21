/**
 * Apply side effects + wait for a retry decision.
 */

import { invalidateCapabilityCache } from '../provider-capability-cache/index.js';
import { sleepMs } from './retry-backoff.js';
import { logRetryPolicyEvent } from './retry-policy-log.js';
import {
  incrRetryMetric,
  recordRetryLatency,
} from './retry-policy-metrics.js';

/**
 * @param {import('./retry-policy-engine.js').RetryPolicyDecision} decision
 * @param {{
 *   provider?: string|null;
 *   operation?: string|null;
 *   requestId?: string|null;
 *   hostId?: string|null;
 *   category?: string|null;
 *   errorCode?: string|number|null;
 *   retryCount?: number;
 *   onProgress?: (tick: string, meta?: object) => void | Promise<void>;
 * }} [ctx]
 */
export async function applyRetryDecision(decision, ctx = {}) {
  if (!decision) return decision;

  if (decision.refreshCapabilityCache && ctx.provider) {
    invalidateCapabilityCache(ctx.provider, 'currencies', { requestId: ctx.requestId });
    invalidateCapabilityCache(ctx.provider, 'capabilities', { requestId: ctx.requestId });
  }

  if (decision.failImmediately || !decision.retry) {
    logRetryPolicyEvent(
      'RETRY_ABORTED',
      {
        requestId: ctx.requestId,
        provider: ctx.provider,
        operation: ctx.operation,
        category: decision.category ?? ctx.category,
        errorCode: ctx.errorCode ?? null,
        retryCount: ctx.retryCount ?? null,
        decision: decision.decision,
        waitDurationMs: decision.waitDurationMs,
        hostId: ctx.hostId ?? null,
      },
      'Retry aborted',
    );
    return decision;
  }

  if (decision.retryAnotherHost) {
    logRetryPolicyEvent(
      'RETRY_HOST_SWITCH',
      {
        requestId: ctx.requestId,
        provider: ctx.provider,
        operation: ctx.operation,
        category: decision.category,
        errorCode: ctx.errorCode ?? null,
        retryCount: ctx.retryCount ?? null,
        decision: decision.decision,
        waitDurationMs: decision.waitDurationMs,
        hostId: ctx.hostId ?? null,
      },
      'Retry switching host',
    );
  }

  if (decision.retryAnotherProvider) {
    incrRetryMetric('providerSwitches');
    logRetryPolicyEvent(
      'RETRY_PROVIDER_SWITCH',
      {
        requestId: ctx.requestId,
        provider: ctx.provider,
        operation: ctx.operation,
        category: decision.category,
        errorCode: ctx.errorCode ?? null,
        retryCount: ctx.retryCount ?? null,
        decision: decision.decision,
        waitDurationMs: decision.waitDurationMs,
        hostId: ctx.hostId ?? null,
      },
      'Retry switching provider',
    );
  }

  logRetryPolicyEvent(
    'RETRY_STARTED',
    {
      requestId: ctx.requestId,
      provider: ctx.provider,
      operation: ctx.operation,
      category: decision.category,
      errorCode: ctx.errorCode ?? null,
      retryCount: ctx.retryCount ?? null,
      decision: decision.decision,
      waitDurationMs: decision.waitDurationMs,
      hostId: ctx.hostId ?? null,
    },
    'Retry started',
  );

  if (ctx.onProgress && decision.progressTick) {
    await ctx.onProgress(decision.progressTick, {
      message: decision.progressMessageVi || decision.progressMessage,
    });
  }

  if (decision.waitDurationMs > 0) {
    logRetryPolicyEvent(
      'RETRY_WAIT',
      {
        requestId: ctx.requestId,
        provider: ctx.provider,
        operation: ctx.operation,
        category: decision.category,
        errorCode: ctx.errorCode ?? null,
        retryCount: ctx.retryCount ?? null,
        decision: decision.decision,
        waitDurationMs: decision.waitDurationMs,
        hostId: ctx.hostId ?? null,
      },
      'Retry waiting',
    );
    if (ctx.onProgress) {
      await ctx.onProgress('retry_wait', {
        message: decision.progressMessageVi || decision.progressMessage,
      });
    }
    const started = Date.now();
    await sleepMs(decision.waitDurationMs);
    recordRetryLatency(Date.now() - started);
  }

  return decision;
}

/**
 * Mark that a provision eventually succeeded after retries.
 */
export function markRetrySuccess() {
  incrRetryMetric('successesAfterRetry');
}

/**
 * Mark that retries exhausted without success.
 */
export function markRetryFailure() {
  incrRetryMetric('failuresAfterRetry');
}
