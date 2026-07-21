function envInt(name, fallback) {
  const raw = Number(process.env[name] ?? fallback);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

function envMs(name, fallback) {
  const raw = Number(process.env[name] ?? fallback);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

function envFloat(name, fallback) {
  const raw = Number(process.env[name] ?? fallback);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

/** @typedef {'immediate'|'fixed'|'exponential'|'exponential_jitter'} BackoffStrategy */

export const RETRY_POLICY = {
  maxRetriesPerProvision: envInt('PROVIDER_RETRY_MAX_PER_PROVISION', 12),
  jitterRatio: envFloat('PROVIDER_RETRY_JITTER_RATIO', 0.2),

  limits: {
    CURRENCY: {
      maxSameHostRetries: envInt('PROVIDER_RETRY_CURRENCY_SAME_HOST', 0),
      maxRetries: envInt('PROVIDER_RETRY_CURRENCY_MAX', 8),
    },
    RATE_LIMIT: {
      maxSameHostRetries: envInt('PROVIDER_RETRY_RATE_LIMIT_SAME_HOST', 3),
      maxRetries: envInt('PROVIDER_RETRY_RATE_LIMIT_MAX', 5),
    },
    PROVIDER_INTERNAL: {
      // Default 0: Clore code-1 / 5xx burn rate-limit if retried on the same host.
      maxSameHostRetries: envInt('PROVIDER_RETRY_INTERNAL_SAME_HOST', 0),
      maxRetries: envInt('PROVIDER_RETRY_INTERNAL_MAX', 8),
    },
    NETWORK: {
      maxSameHostRetries: envInt('PROVIDER_RETRY_NETWORK_SAME_HOST', 2),
      maxRetries: envInt('PROVIDER_RETRY_NETWORK_MAX', 5),
    },
    TIMEOUT: {
      maxSameHostRetries: envInt('PROVIDER_RETRY_TIMEOUT_SAME_HOST', 0),
      maxRetries: envInt('PROVIDER_RETRY_TIMEOUT_MAX', 5),
    },
    IMAGE_PULL: {
      maxSameHostRetries: envInt('PROVIDER_RETRY_IMAGE_SAME_HOST', 0),
      maxRetries: envInt('PROVIDER_RETRY_IMAGE_MAX', 6),
    },
    HEALTH: {
      maxSameHostRetries: envInt('PROVIDER_RETRY_HEALTH_SAME_HOST', 0),
      maxRetries: envInt('PROVIDER_RETRY_HEALTH_MAX', 6),
    },
    ENDPOINT: {
      maxSameHostRetries: envInt('PROVIDER_RETRY_ENDPOINT_SAME_HOST', 0),
      maxRetries: envInt('PROVIDER_RETRY_ENDPOINT_MAX', 6),
    },
    NO_CAPACITY: {
      maxSameHostRetries: envInt('PROVIDER_RETRY_CAPACITY_SAME_HOST', 0),
      maxRetries: envInt('PROVIDER_RETRY_CAPACITY_MAX', 8),
    },
    AUTH: { maxSameHostRetries: 0, maxRetries: 0 },
    VALIDATION: { maxSameHostRetries: 0, maxRetries: 0 },
    UNKNOWN: {
      maxSameHostRetries: envInt('PROVIDER_RETRY_UNKNOWN_SAME_HOST', 1),
      maxRetries: envInt('PROVIDER_RETRY_UNKNOWN_MAX', 1),
    },
  },

  backoff: {
    CURRENCY: { strategy: 'immediate', baseMs: 0, maxMs: 0 },
    RATE_LIMIT: {
      strategy: 'exponential_jitter',
      baseMs: envMs('PROVIDER_RETRY_RATE_LIMIT_BASE_MS', 6000),
      maxMs: envMs('PROVIDER_RETRY_RATE_LIMIT_MAX_MS', 60_000),
    },
    PROVIDER_INTERNAL: {
      strategy: 'exponential_jitter',
      baseMs: envMs('PROVIDER_RETRY_INTERNAL_BASE_MS', 2000),
      maxMs: envMs('PROVIDER_RETRY_INTERNAL_MAX_MS', 30_000),
    },
    NETWORK: {
      strategy: 'exponential_jitter',
      baseMs: envMs('PROVIDER_RETRY_NETWORK_BASE_MS', 1000),
      maxMs: envMs('PROVIDER_RETRY_NETWORK_MAX_MS', 16_000),
    },
    TIMEOUT: {
      strategy: 'fixed',
      baseMs: envMs('PROVIDER_RETRY_TIMEOUT_BASE_MS', 500),
      maxMs: envMs('PROVIDER_RETRY_TIMEOUT_MAX_MS', 2000),
    },
    IMAGE_PULL: { strategy: 'immediate', baseMs: 0, maxMs: 0 },
    HEALTH: { strategy: 'immediate', baseMs: 0, maxMs: 0 },
    ENDPOINT: { strategy: 'immediate', baseMs: 0, maxMs: 0 },
    NO_CAPACITY: {
      strategy: 'fixed',
      baseMs: envMs('PROVIDER_RETRY_CAPACITY_BASE_MS', 300),
      maxMs: 2000,
    },
    AUTH: { strategy: 'immediate', baseMs: 0, maxMs: 0 },
    VALIDATION: { strategy: 'immediate', baseMs: 0, maxMs: 0 },
    UNKNOWN: {
      strategy: 'fixed',
      baseMs: envMs('PROVIDER_RETRY_UNKNOWN_BASE_MS', 1000),
      maxMs: 5000,
    },
  },
};
