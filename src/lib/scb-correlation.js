/**
 * SCB 2.1 — correlation id helpers for detect → queue → worker → pipeline tracing.
 * Delegates structured output to the centralized logger when available.
 */

import { randomUUID } from 'crypto';
import { logger } from './logging/logger.js';

/**
 * @param {string} [seed]
 * @returns {string}
 */
export function createCorrelationId(seed) {
  if (seed && /^[0-9a-f-]{36}$/i.test(seed)) return seed;
  return randomUUID();
}

/**
 * @param {string} scope
 * @param {string|null|undefined} correlationId
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
export function logWithCorrelation(scope, correlationId, message, meta = {}) {
  const channel =
    scope.includes('provider') || scope.includes('vast') || scope.includes('clore')
      ? 'provider'
      : scope.includes('worker') || scope.includes('machine-op')
        ? 'worker'
        : scope.includes('api') || scope.includes('user/') || scope.includes('machines/')
          ? 'api'
          : 'app';

  logger(channel).info(
    {
      requestId: correlationId ?? null,
      correlationId: correlationId ?? null,
      operation: scope,
      ...meta,
    },
    message,
  );
}
