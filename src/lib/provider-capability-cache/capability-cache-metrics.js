const counters = {
  hits: 0,
  misses: 0,
  staleServes: 0,
  providerRequests: 0,
  backgroundRefreshCount: 0,
  invalidations: 0,
};

/** @type {number[]} */
const latencies = [];

export function incrCapabilityCacheMetric(name, delta = 1) {
  if (!(name in counters)) return;
  counters[name] += delta;
}

export function recordCapabilityLatency(ms) {
  if (!Number.isFinite(ms) || ms < 0) return;
  latencies.push(ms);
  if (latencies.length > 200) latencies.shift();
}

export function getCapabilityCacheMetrics() {
  const total = counters.hits + counters.misses;
  const avg =
    latencies.length === 0
      ? null
      : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  return {
    cacheHitRate: total > 0 ? counters.hits / total : null,
    cacheMissRate: total > 0 ? counters.misses / total : null,
    averageCapabilityLatency: avg,
    providerCapabilityRequests: counters.providerRequests,
    backgroundRefreshCount: counters.backgroundRefreshCount,
    staleServes: counters.staleServes,
    invalidations: counters.invalidations,
    hits: counters.hits,
    misses: counters.misses,
  };
}

export function resetCapabilityCacheMetrics() {
  counters.hits = 0;
  counters.misses = 0;
  counters.staleServes = 0;
  counters.providerRequests = 0;
  counters.backgroundRefreshCount = 0;
  counters.invalidations = 0;
  latencies.length = 0;
}