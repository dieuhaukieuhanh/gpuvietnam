/**
 * Classify provision/provider failures into reputation categories.
 */

export const HOST_FAILURE_CATEGORY = {
  HEALTH_FAILURE: 'HEALTH_FAILURE',
  IMAGE_PULL_FAILURE: 'IMAGE_PULL_FAILURE',
  ENDPOINT_FAILURE: 'ENDPOINT_FAILURE',
  RATE_LIMIT: 'RATE_LIMIT',
  CURRENCY: 'CURRENCY',
  PROVIDER_INTERNAL: 'PROVIDER_INTERNAL',
  NETWORK: 'NETWORK',
  UNKNOWN: 'UNKNOWN',
};

/**
 * @param {unknown} errorOrMessage
 * @param {{ phase?: string }} [context]
 */
export function classifyHostFailure(errorOrMessage, context = {}) {
  const message = (
    errorOrMessage instanceof Error
      ? errorOrMessage.message
      : String(errorOrMessage ?? '')
  ).toLowerCase();
  const phase = String(context.phase ?? '').toLowerCase();

  if (/currency-not-allowed|wallet empty|usd-blockchain|allowed.?coins|code.?6/.test(message)) {
    return HOST_FAILURE_CATEGORY.CURRENCY;
  }
  if (/\b429\b|rate.?limit|code.?5/.test(message)) {
    return HOST_FAILURE_CATEGORY.RATE_LIMIT;
  }
  if (
    /image.?pull|pull.*image|manifest unknown|no such image|failed to pull|docker.?pull/.test(message) ||
    phase.includes('image')
  ) {
    return HOST_FAILURE_CATEGORY.IMAGE_PULL_FAILURE;
  }
  if (
    /comfy|health|system_stats|never.?healthy|unhealthy|disconnected/.test(message) ||
    phase.includes('health') ||
    phase.includes('comfy')
  ) {
    return HOST_FAILURE_CATEGORY.HEALTH_FAILURE;
  }
  if (
    /endpoint|http_pub|port.?map|no mapped port|hostport|tcp_ports|comfyui endpoint unavailable/.test(
      message,
    ) ||
    phase.includes('endpoint')
  ) {
    return HOST_FAILURE_CATEGORY.ENDPOINT_FAILURE;
  }
  if (
    /code.?1|database error|internal server error|server-offline|provider.?internal|\b502\b|\b503\b|\b504\b/.test(
      message,
    ) ||
    phase.includes('provider_internal')
  ) {
    return HOST_FAILURE_CATEGORY.PROVIDER_INTERNAL;
  }
  if (
    /timeout|etimedout|econnreset|network error|fetch failed|socket hang up|enotfound/.test(message) ||
    phase.includes('network')
  ) {
    return HOST_FAILURE_CATEGORY.NETWORK;
  }
  if (/no such container|gpu\/container|exited|bad host|container/.test(message)) {
    return HOST_FAILURE_CATEGORY.IMAGE_PULL_FAILURE;
  }
  return HOST_FAILURE_CATEGORY.UNKNOWN;
}
