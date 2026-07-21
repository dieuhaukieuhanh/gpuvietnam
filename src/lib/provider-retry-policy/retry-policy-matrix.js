/**
 * Default retry decision matrix by category.
 * Provider hooks may override after this baseline is computed.
 */

import { RETRY_ERROR_CATEGORY } from './retry-error-categories.js';
import { RETRY_POLICY } from './retry-policy-config.js';
import { computeBackoffMs } from './retry-backoff.js';

/**
 * @typedef {object} RetryMatrixRow
 * @property {boolean} retrySameHostPreferred
 * @property {boolean} retryAnotherHost
 * @property {boolean} retryAnotherProvider
 * @property {boolean} blacklistHost
 * @property {boolean} refreshMarketplace
 * @property {boolean} refreshCapabilityCache
 * @property {boolean} failImmediately
 */

/** @type {Record<string, RetryMatrixRow>} */
export const RETRY_MATRIX = {
  [RETRY_ERROR_CATEGORY.CURRENCY]: {
    retrySameHostPreferred: false,
    retryAnotherHost: true,
    retryAnotherProvider: true,
    blacklistHost: false,
    refreshMarketplace: false,
    refreshCapabilityCache: true,
    failImmediately: false,
  },
  [RETRY_ERROR_CATEGORY.RATE_LIMIT]: {
    retrySameHostPreferred: true,
    retryAnotherHost: true,
    retryAnotherProvider: true,
    blacklistHost: false,
    refreshMarketplace: false,
    refreshCapabilityCache: false,
    failImmediately: false,
  },
  [RETRY_ERROR_CATEGORY.PROVIDER_INTERNAL]: {
    // Code 1 / 5xx rarely recovers on the same host; switch immediately.
    retrySameHostPreferred: false,
    retryAnotherHost: true,
    retryAnotherProvider: true,
    blacklistHost: true,
    refreshMarketplace: false,
    refreshCapabilityCache: false,
    failImmediately: false,
  },
  [RETRY_ERROR_CATEGORY.NETWORK]: {
    retrySameHostPreferred: true,
    retryAnotherHost: true,
    retryAnotherProvider: true,
    blacklistHost: false,
    refreshMarketplace: false,
    refreshCapabilityCache: false,
    failImmediately: false,
  },
  [RETRY_ERROR_CATEGORY.TIMEOUT]: {
    retrySameHostPreferred: false,
    retryAnotherHost: true,
    retryAnotherProvider: true,
    blacklistHost: false,
    refreshMarketplace: false,
    refreshCapabilityCache: false,
    failImmediately: false,
  },
  [RETRY_ERROR_CATEGORY.IMAGE_PULL]: {
    retrySameHostPreferred: false,
    retryAnotherHost: true,
    retryAnotherProvider: true,
    blacklistHost: true,
    refreshMarketplace: false,
    refreshCapabilityCache: false,
    failImmediately: false,
  },
  [RETRY_ERROR_CATEGORY.HEALTH]: {
    retrySameHostPreferred: false,
    retryAnotherHost: true,
    retryAnotherProvider: true,
    blacklistHost: true,
    refreshMarketplace: false,
    refreshCapabilityCache: false,
    failImmediately: false,
  },
  [RETRY_ERROR_CATEGORY.ENDPOINT]: {
    retrySameHostPreferred: false,
    retryAnotherHost: true,
    retryAnotherProvider: true,
    blacklistHost: true,
    refreshMarketplace: false,
    refreshCapabilityCache: false,
    failImmediately: false,
  },
  [RETRY_ERROR_CATEGORY.NO_CAPACITY]: {
    retrySameHostPreferred: false,
    retryAnotherHost: true,
    retryAnotherProvider: true,
    blacklistHost: false,
    refreshMarketplace: true,
    refreshCapabilityCache: false,
    failImmediately: false,
  },
  [RETRY_ERROR_CATEGORY.AUTH]: {
    retrySameHostPreferred: false,
    retryAnotherHost: false,
    retryAnotherProvider: false,
    blacklistHost: false,
    refreshMarketplace: false,
    refreshCapabilityCache: false,
    failImmediately: true,
  },
  [RETRY_ERROR_CATEGORY.VALIDATION]: {
    retrySameHostPreferred: false,
    retryAnotherHost: false,
    retryAnotherProvider: false,
    blacklistHost: false,
    refreshMarketplace: false,
    refreshCapabilityCache: false,
    failImmediately: true,
  },
  [RETRY_ERROR_CATEGORY.UNKNOWN]: {
    retrySameHostPreferred: true,
    retryAnotherHost: false,
    retryAnotherProvider: false,
    blacklistHost: false,
    refreshMarketplace: false,
    refreshCapabilityCache: false,
    failImmediately: false,
  },
};

export const RETRY_PROGRESS = {
  RETRYING: {
    tick: 'retrying',
    message: 'Retrying...',
    messageVi: 'Đang thử lại...',
  },
  WAITING_PROVIDER: {
    tick: 'retry_wait',
    message: 'Waiting for provider...',
    messageVi: 'Đang chờ provider...',
  },
  HOST_SWITCH: {
    tick: 'retry_host_switch',
    message: 'Trying another host...',
    messageVi: 'Đang thử host khác...',
  },
  MARKETPLACE_REFRESH: {
    tick: 'marketplace_refetch',
    message: 'Refreshing marketplace...',
    messageVi: 'Đang làm mới marketplace...',
  },
  PROVIDER_SWITCH: {
    tick: 'retry_provider_switch',
    message: 'Trying another provider...',
    messageVi: 'Đang chuyển provider...',
  },
  ABORTED: {
    tick: 'retry_aborted',
    message: 'Retry aborted',
    messageVi: 'Đã dừng thử lại',
  },
};

/**
 * @param {string} category
 */
export function getMatrixRow(category) {
  return RETRY_MATRIX[category] || RETRY_MATRIX[RETRY_ERROR_CATEGORY.UNKNOWN];
}

/**
 * @param {string} category
 * @param {number} retryCount
 * @param {{ rng?: () => number }} [options]
 */
export function getBackoffForCategory(category, retryCount, options = {}) {
  const cfg = RETRY_POLICY.backoff[category] || RETRY_POLICY.backoff.UNKNOWN;
  return {
    strategy: cfg.strategy,
    waitDurationMs: computeBackoffMs({
      strategy: cfg.strategy,
      baseMs: cfg.baseMs,
      maxMs: cfg.maxMs,
      retryCount,
      rng: options.rng,
    }),
  };
}

/**
 * Pick progress UX for a decision shape.
 * @param {{
 *   failImmediately?: boolean;
 *   retrySameHost?: boolean;
 *   retryAnotherHost?: boolean;
 *   retryAnotherProvider?: boolean;
 *   refreshMarketplace?: boolean;
 *   waitDurationMs?: number;
 * }} decision
 */
export function progressForDecision(decision) {
  if (decision.failImmediately) return RETRY_PROGRESS.ABORTED;
  if (decision.retryAnotherProvider) return RETRY_PROGRESS.PROVIDER_SWITCH;
  if (decision.refreshMarketplace) return RETRY_PROGRESS.MARKETPLACE_REFRESH;
  if (decision.retryAnotherHost && !decision.retrySameHost) return RETRY_PROGRESS.HOST_SWITCH;
  if ((decision.waitDurationMs || 0) > 0) return RETRY_PROGRESS.WAITING_PROVIDER;
  return RETRY_PROGRESS.RETRYING;
}
