/**
 * Provider Retry Policy Engine — centralized retry decisions.
 */

export { RETRY_ERROR_CATEGORY, classifyRetryError, mapHostFailureCategoryToRetry } from './retry-error-categories.js';
export { RETRY_POLICY } from './retry-policy-config.js';
export { computeBackoffMs, exponentialDelayMs, applyJitter, sleepMs } from './retry-backoff.js';
export {
  RETRY_MATRIX,
  RETRY_PROGRESS,
  getMatrixRow,
  getBackoffForCategory,
  progressForDecision,
} from './retry-policy-matrix.js';
export {
  registerRetryPolicyHook,
  applyRetryPolicyHooks,
  clearRetryPolicyHooksForTests,
} from './retry-policy-hooks.js';
export {
  decideRetryPolicy,
  shouldRetryAnotherHost,
  shouldRetrySameHost,
  shouldRetryAnotherProvider,
  shouldContinueOfferLoop,
} from './retry-policy-engine.js';
export {
  applyRetryDecision,
  markRetrySuccess,
  markRetryFailure,
} from './retry-policy-execute.js';
export {
  getRetryPolicyMetrics,
  resetRetryPolicyMetrics,
  recordRetriesForProvision,
} from './retry-policy-metrics.js';
export { ensureDefaultRetryPolicyHooks } from './retry-policy-defaults.js';

import { ensureDefaultRetryPolicyHooks } from './retry-policy-defaults.js';
ensureDefaultRetryPolicyHooks();