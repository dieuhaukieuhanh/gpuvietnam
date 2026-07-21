/**
 * Central Retry Policy Engine — decide retry behavior from classified errors.
 */

import { RETRY_POLICY } from './retry-policy-config.js';
import { classifyRetryError, RETRY_ERROR_CATEGORY } from './retry-error-categories.js';
import {
  getBackoffForCategory,
  getMatrixRow,
  progressForDecision,
} from './retry-policy-matrix.js';
import { applyRetryPolicyHooks } from './retry-policy-hooks.js';
import { logRetryPolicyEvent } from './retry-policy-log.js';
import {
  incrRetryMetric,
  recordRetryByCategory,
} from './retry-policy-metrics.js';

/**
 * @param {object} input
 * @returns {object}
 */
export function decideRetryPolicy(input) {
  const retryCount = Math.max(0, Number(input.retryCount) || 0);
  const provisionRetryCount = Math.max(
    0,
    Number(input.provisionRetryCount ?? input.retryCount) || 0,
  );
  const category = classifyRetryError(input.error ?? input.errorCategory, {
    errorCategory: input.errorCategory,
    errorCode: input.errorCode,
    httpStatus: input.httpStatus,
    phase: input.phase,
    operation: input.operation,
  });

  const limits = RETRY_POLICY.limits[category] || RETRY_POLICY.limits.UNKNOWN;
  const matrix = getMatrixRow(category);
  const backoff = getBackoffForCategory(category, retryCount, { rng: input.rng });

  let decision = {
    retry: false,
    waitDurationMs: 0,
    retrySameHost: false,
    retryAnotherHost: false,
    retryAnotherProvider: false,
    blacklistHost: Boolean(matrix.blacklistHost),
    refreshMarketplace: Boolean(matrix.refreshMarketplace),
    refreshCapabilityCache: Boolean(matrix.refreshCapabilityCache),
    failImmediately: Boolean(matrix.failImmediately),
    category,
    backoffStrategy: backoff.strategy,
    progressTick: 'retry_aborted',
    progressMessage: 'Retry aborted',
    progressMessageVi: 'Da dung thu lai',
    decision: 'abort',
  };

  if (matrix.failImmediately || limits.maxRetries <= 0) {
    decision.failImmediately = true;
    decision.retry = false;
    decision.decision = 'fail_immediately';
    finalize(input, decision, retryCount);
    return decision;
  }

  if (provisionRetryCount >= RETRY_POLICY.maxRetriesPerProvision) {
    decision.failImmediately = true;
    decision.retry = false;
    decision.decision = 'provision_retry_cap';
    finalize(input, decision, retryCount);
    return decision;
  }

  if (retryCount >= limits.maxRetries) {
    decision.failImmediately = false;
    decision.retry = false;
    decision.retryAnotherProvider = Boolean(matrix.retryAnotherProvider);
    decision.decision = decision.retryAnotherProvider
      ? 'escalate_provider'
      : 'retries_exhausted';
    if (decision.retryAnotherProvider) {
      decision.retry = true;
      const progress = progressForDecision({
        retryAnotherProvider: true,
        waitDurationMs: 0,
      });
      decision.progressTick = progress.tick;
      decision.progressMessage = progress.message;
      decision.progressMessageVi = progress.messageVi;
    }
    finalize(input, decision, retryCount);
    return decision;
  }

  const sameHostLeft = retryCount < limits.maxSameHostRetries && matrix.retrySameHostPreferred;
  if (sameHostLeft) {
    decision.retry = true;
    decision.retrySameHost = true;
    decision.retryAnotherHost = false;
    decision.retryAnotherProvider = false;
    decision.waitDurationMs = backoff.waitDurationMs;
    decision.decision = 'retry_same_host';
  } else if (matrix.retryAnotherHost) {
    decision.retry = true;
    decision.retrySameHost = false;
    decision.retryAnotherHost = true;
    decision.retryAnotherProvider = false;
    decision.waitDurationMs =
      matrix.retrySameHostPreferred && retryCount < limits.maxSameHostRetries
        ? backoff.waitDurationMs
        : Math.min(backoff.waitDurationMs, 500);
    decision.refreshMarketplace =
      decision.refreshMarketplace || category === RETRY_ERROR_CATEGORY.NO_CAPACITY;
    decision.decision = decision.refreshMarketplace
      ? 'refresh_marketplace_and_switch_host'
      : 'retry_another_host';
  } else if (matrix.retryAnotherProvider) {
    decision.retry = true;
    decision.retryAnotherProvider = true;
    decision.decision = 'retry_another_provider';
  } else {
    decision.failImmediately = true;
    decision.retry = false;
    decision.decision = 'fail_immediately';
  }

  const progress = progressForDecision(decision);
  decision.progressTick = progress.tick;
  decision.progressMessage = progress.message;
  decision.progressMessageVi = progress.messageVi;

  decision = applyRetryPolicyHooks(
    {
      ...input,
      category,
      retryCount,
      provisionRetryCount,
    },
    decision,
  );

  finalize(input, decision, retryCount);
  return decision;
}

function finalize(input, decision, retryCount) {
  recordRetryByCategory(decision.category);
  if (decision.failImmediately || decision.decision === 'abort') {
    incrRetryMetric('aborted');
  }
  if (decision.retry) incrRetryMetric('retries');
  if (decision.retryAnotherHost) incrRetryMetric('hostSwitches');
  if (decision.retryAnotherProvider) incrRetryMetric('providerSwitches');

  logRetryPolicyEvent(
    'RETRY_POLICY_SELECTED',
    {
      requestId: input.requestId,
      provider: input.provider,
      operation: input.operation,
      category: decision.category,
      errorCode: input.errorCode ?? null,
      retryCount,
      hostId: input.hostId ?? null,
      decision: decision.decision,
      waitDurationMs: decision.waitDurationMs,
      retry: decision.retry,
      retrySameHost: decision.retrySameHost,
      retryAnotherHost: decision.retryAnotherHost,
      retryAnotherProvider: decision.retryAnotherProvider,
      blacklistHost: decision.blacklistHost,
      refreshMarketplace: decision.refreshMarketplace,
      refreshCapabilityCache: decision.refreshCapabilityCache,
      failImmediately: decision.failImmediately,
    },
    'Retry policy selected',
  );
}

export function shouldRetryAnotherHost(decision) {
  return Boolean(decision?.retry && decision.retryAnotherHost && !decision.failImmediately);
}

export function shouldRetrySameHost(decision) {
  return Boolean(decision?.retry && decision.retrySameHost && !decision.failImmediately);
}

export function shouldRetryAnotherProvider(decision) {
  return Boolean(
    decision?.retry && decision.retryAnotherProvider && !decision.failImmediately,
  );
}

export function shouldContinueOfferLoop(input) {
  const decision = decideRetryPolicy(input);
  return {
    decision,
    continue: shouldRetryAnotherHost(decision) || Boolean(decision.refreshMarketplace),
  };
}