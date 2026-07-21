/**
 * Built-in provider overrides. Keeps provider-specific timing out of the engine core.
 */

import { RETRY_ERROR_CATEGORY } from './retry-error-categories.js';
import { registerRetryPolicyHook } from './retry-policy-hooks.js';

/** Mirrors Clore create_order spacing without importing clore-client (avoid cycles). */
const CLORE_CREATE_ORDER_MIN_INTERVAL_MS = Number(
  process.env.CLORE_CREATE_ORDER_MIN_INTERVAL_MS ?? 5500,
);

let hooksRegistered = false;

/**
 * Register built-in provider overrides (idempotent).
 */
export function ensureDefaultRetryPolicyHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;

  registerRetryPolicyHook('clore', 'create_order', (input, decision) => {
    const category = String(input.category || decision.category || '');

    // Code 1 / internal: never burn 5.5s same-host retries — switch host immediately.
    if (category === RETRY_ERROR_CATEGORY.PROVIDER_INTERNAL) {
      return {
        ...decision,
        retry: true,
        failImmediately: false,
        retrySameHost: false,
        retryAnotherHost: true,
        retryAnotherProvider: false,
        blacklistHost: true,
        waitDurationMs: 0,
        decision: 'retry_another_host',
        progressTick: 'retry_host_switch',
        progressMessage: 'Trying another host...',
        progressMessageVi: 'Dang thu may khac...',
      };
    }

    if (!decision?.retry) return decision;
    // Only RATE_LIMIT needs the Clore create_order spacing.
    if (category !== RETRY_ERROR_CATEGORY.RATE_LIMIT) return decision;
    const minWait = CLORE_CREATE_ORDER_MIN_INTERVAL_MS;
    if ((decision.waitDurationMs || 0) < minWait) {
      return {
        ...decision,
        waitDurationMs: minWait,
        progressTick: 'retry_wait',
        progressMessage: 'Waiting for provider...',
        progressMessageVi: 'Dang cho provider...',
      };
    }
    return decision;
  });

  registerRetryPolicyHook('clore', 'rent', (input, decision) => {
    const category = String(input.category || decision.category || '');
    if (category === RETRY_ERROR_CATEGORY.CURRENCY) {
      return {
        ...decision,
        retry: true,
        failImmediately: false,
        retrySameHost: false,
        retryAnotherHost: true,
        refreshCapabilityCache: true,
        decision: 'retry_another_host',
      };
    }
    if (category === RETRY_ERROR_CATEGORY.PROVIDER_INTERNAL) {
      return {
        ...decision,
        retry: true,
        failImmediately: false,
        retrySameHost: false,
        retryAnotherHost: true,
        blacklistHost: true,
        waitDurationMs: 0,
        decision: 'retry_another_host',
        progressTick: 'retry_host_switch',
        progressMessage: 'Trying another host...',
        progressMessageVi: 'Dang thu may khac...',
      };
    }
    return decision;
  });
}

export function resetDefaultRetryPolicyHooksFlagForTests() {
  hooksRegistered = false;
}