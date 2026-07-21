/**
 * Backoff calculators for the Retry Policy Engine.
 */

import { RETRY_POLICY } from './retry-policy-config.js';

/**
 * @param {number} baseMs
 * @param {number} retryCount  retries already completed (0 = first wait)
 * @param {number} [maxMs]
 */
export function exponentialDelayMs(baseMs, retryCount, maxMs = 60_000) {
  const exp = Math.max(0, Number(retryCount) || 0);
  const raw = Number(baseMs) * 2 ** exp;
  return Math.min(Math.max(0, raw), maxMs);
}

/**
 * @param {number} delayMs
 * @param {number} [jitterRatio]
 * @param {() => number} [rng]
 */
export function applyJitter(delayMs, jitterRatio = RETRY_POLICY.jitterRatio, rng = Math.random) {
  const d = Math.max(0, Number(delayMs) || 0);
  const ratio = Math.max(0, Math.min(1, Number(jitterRatio) || 0));
  if (d === 0 || ratio === 0) return d;
  const delta = d * ratio;
  const offset = (rng() * 2 - 1) * delta;
  return Math.max(0, Math.round(d + offset));
}

/**
 * @param {{
 *   strategy?: string;
 *   baseMs?: number;
 *   maxMs?: number;
 *   retryCount?: number;
 *   jitterRatio?: number;
 *   rng?: () => number;
 * }} options
 */
export function computeBackoffMs(options = {}) {
  const strategy = String(options.strategy || 'immediate');
  const baseMs = Number(options.baseMs ?? 0) || 0;
  const maxMs = Number(options.maxMs ?? 60_000) || 60_000;
  const retryCount = Math.max(0, Number(options.retryCount) || 0);

  if (strategy === 'immediate' || baseMs <= 0) return 0;
  if (strategy === 'fixed') {
    return Math.min(baseMs, maxMs);
  }
  if (strategy === 'exponential') {
    return exponentialDelayMs(baseMs, retryCount, maxMs);
  }
  if (strategy === 'exponential_jitter') {
    return applyJitter(
      exponentialDelayMs(baseMs, retryCount, maxMs),
      options.jitterRatio ?? RETRY_POLICY.jitterRatio,
      options.rng,
    );
  }
  return Math.min(baseMs, maxMs);
}

/**
 * @param {number} ms
 */
export function sleepMs(ms) {
  const wait = Math.max(0, Number(ms) || 0);
  if (wait <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, wait));
}
