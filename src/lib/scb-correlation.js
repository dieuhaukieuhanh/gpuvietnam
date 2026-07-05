/**
 * SCB 2.1 — correlation id helpers for detect → queue → worker → pipeline tracing.
 */

import { randomUUID } from 'crypto';

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
  console.log(`[${scope}]`, {
    correlationId: correlationId ?? null,
    message,
    ...meta,
  });
}
