/**
 * Canonical retry error categories (provider-agnostic).
 */

export const RETRY_ERROR_CATEGORY = {
  CURRENCY: 'CURRENCY',
  RATE_LIMIT: 'RATE_LIMIT',
  PROVIDER_INTERNAL: 'PROVIDER_INTERNAL',
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  IMAGE_PULL: 'IMAGE_PULL',
  HEALTH: 'HEALTH',
  ENDPOINT: 'ENDPOINT',
  NO_CAPACITY: 'NO_CAPACITY',
  AUTH: 'AUTH',
  VALIDATION: 'VALIDATION',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Map Host Reputation categories → retry categories.
 * @param {string} hostCategory
 */
export function mapHostFailureCategoryToRetry(hostCategory) {
  switch (String(hostCategory || '')) {
    case 'HEALTH_FAILURE':
      return RETRY_ERROR_CATEGORY.HEALTH;
    case 'IMAGE_PULL_FAILURE':
      return RETRY_ERROR_CATEGORY.IMAGE_PULL;
    case 'ENDPOINT_FAILURE':
      return RETRY_ERROR_CATEGORY.ENDPOINT;
    case 'RATE_LIMIT':
      return RETRY_ERROR_CATEGORY.RATE_LIMIT;
    case 'CURRENCY':
      return RETRY_ERROR_CATEGORY.CURRENCY;
    case 'PROVIDER_INTERNAL':
      return RETRY_ERROR_CATEGORY.PROVIDER_INTERNAL;
    case 'NETWORK':
      return RETRY_ERROR_CATEGORY.NETWORK;
    default:
      return RETRY_ERROR_CATEGORY.UNKNOWN;
  }
}

/**
 * Classify an error into a canonical retry category.
 * @param {unknown} errorOrMessage
 * @param {{
 *   errorCategory?: string|null;
 *   errorCode?: string|number|null;
 *   httpStatus?: number|null;
 *   phase?: string|null;
 *   operation?: string|null;
 * }} [context]
 */
export function classifyRetryError(errorOrMessage, context = {}) {
  if (context.errorCategory && RETRY_ERROR_CATEGORY[String(context.errorCategory)]) {
    return String(context.errorCategory);
  }
  const known = Object.values(RETRY_ERROR_CATEGORY);
  if (context.errorCategory && known.includes(String(context.errorCategory))) {
    return String(context.errorCategory);
  }

  const http = Number(context.httpStatus);
  if (http === 401 || http === 403) return RETRY_ERROR_CATEGORY.AUTH;
  if (http === 429) return RETRY_ERROR_CATEGORY.RATE_LIMIT;
  if (http === 502 || http === 503 || http === 504) {
    return RETRY_ERROR_CATEGORY.PROVIDER_INTERNAL;
  }

  const code = context.errorCode != null ? String(context.errorCode) : '';
  if (code === '5' || code === '429') return RETRY_ERROR_CATEGORY.RATE_LIMIT;
  if (code === '6') return RETRY_ERROR_CATEGORY.CURRENCY;
  if (code === '1') return RETRY_ERROR_CATEGORY.PROVIDER_INTERNAL;

  const message = (
    errorOrMessage instanceof Error
      ? errorOrMessage.message
      : String(errorOrMessage ?? '')
  ).toLowerCase();
  const phase = String(context.phase ?? context.operation ?? '').toLowerCase();

  if (
    /unauthorized|forbidden|invalid.?api.?key|api.?key|authentication|auth.?fail/.test(message) ||
    phase.includes('auth')
  ) {
    return RETRY_ERROR_CATEGORY.AUTH;
  }
  if (
    /validation|invalid input|unsupported gpu|gpu_configuration|bad request|schema/.test(message) &&
    !/currency|rate.?limit|already.?rented/.test(message)
  ) {
    return RETRY_ERROR_CATEGORY.VALIDATION;
  }
  if (/currency-not-allowed|wallet empty|usd-blockchain|allowed.?coins|code.?6/.test(message)) {
    return RETRY_ERROR_CATEGORY.CURRENCY;
  }
  if (/\b429\b|rate.?limit|code.?5/.test(message)) {
    return RETRY_ERROR_CATEGORY.RATE_LIMIT;
  }
  if (
    /no available workstation|no matching offer|no offers|h[eế]t gpu|out of stock|no_such_ask|already.?rented|server-already-rented|not available|no capacity|capacity/.test(
      message,
    )
  ) {
    return RETRY_ERROR_CATEGORY.NO_CAPACITY;
  }
  if (
    /image.?pull|pull.*image|manifest unknown|no such image|failed to pull|docker.?pull|no such container|gpu\/container|bad host/.test(
      message,
    ) ||
    phase.includes('image')
  ) {
    return RETRY_ERROR_CATEGORY.IMAGE_PULL;
  }
  if (
    /comfy|health|system_stats|never.?healthy|unhealthy|disconnected/.test(message) ||
    phase.includes('health') ||
    phase.includes('comfy')
  ) {
    return RETRY_ERROR_CATEGORY.HEALTH;
  }
  if (
    /endpoint|http_pub|port.?map|no mapped port|hostport|tcp_ports|comfyui endpoint unavailable/.test(
      message,
    ) ||
    phase.includes('endpoint')
  ) {
    return RETRY_ERROR_CATEGORY.ENDPOINT;
  }
  if (
    /\btimeout\b|etimedout|timed?\s*out|abort.*timeout/.test(message) ||
    phase.includes('timeout')
  ) {
    return RETRY_ERROR_CATEGORY.TIMEOUT;
  }
  if (
    /econnreset|network error|fetch failed|socket hang up|enotfound|econnrefused/.test(message) ||
    phase.includes('network')
  ) {
    return RETRY_ERROR_CATEGORY.NETWORK;
  }
  if (
    /code.?1|database error|internal server error|server-offline|provider.?internal|\b502\b|\b503\b|\b504\b|without order id/.test(
      message,
    )
  ) {
    return RETRY_ERROR_CATEGORY.PROVIDER_INTERNAL;
  }

  return RETRY_ERROR_CATEGORY.UNKNOWN;
}
