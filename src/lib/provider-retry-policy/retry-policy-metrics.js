const counters = {
  retries: 0,
  successesAfterRetry: 0,
  failuresAfterRetry: 0,
  providerSwitches: 0,
  hostSwitches: 0,
  aborted: 0,
};

/** @type {Record<string, number>} */
const retryCountByCategory = {};

/** @type {number[]} */
const retriesPerProvision = [];

/** @type {number[]} */
const retryLatencies = [];

export function incrRetryMetric(name, delta = 1) {
  if (!(name in counters)) return;
  counters[name] += delta;
}

export function recordRetryByCategory(category) {
  const key = String(category || 'UNKNOWN');
  retryCountByCategory[key] = (retryCountByCategory[key] || 0) + 1;
}

export function recordRetriesForProvision(count) {
  const n = Math.max(0, Number(count) || 0);
  retriesPerProvision.push(n);
  if (retriesPerProvision.length > 200) retriesPerProvision.shift();
}

export function recordRetryLatency(ms) {
  if (!Number.isFinite(ms) || ms < 0) return;
  retryLatencies.push(ms);
  if (retryLatencies.length > 200) retryLatencies.shift();
}

export function getRetryPolicyMetrics() {
  const decided = counters.successesAfterRetry + counters.failuresAfterRetry;
  const avgRetries =
    retriesPerProvision.length === 0
      ? null
      : Math.round(
          (retriesPerProvision.reduce((a, b) => a + b, 0) / retriesPerProvision.length) * 100,
        ) / 100;
  const avgLatency =
    retryLatencies.length === 0
      ? null
      : Math.round(retryLatencies.reduce((a, b) => a + b, 0) / retryLatencies.length);

  return {
    retryCountByCategory: { ...retryCountByCategory },
    retrySuccessRate: decided > 0 ? counters.successesAfterRetry / decided : null,
    averageRetriesPerProvision: avgRetries,
    providerSwitchCount: counters.providerSwitches,
    hostSwitchCount: counters.hostSwitches,
    retryLatency: avgLatency,
    retries: counters.retries,
    aborted: counters.aborted,
  };
}

export function resetRetryPolicyMetrics() {
  counters.retries = 0;
  counters.successesAfterRetry = 0;
  counters.failuresAfterRetry = 0;
  counters.providerSwitches = 0;
  counters.hostSwitches = 0;
  counters.aborted = 0;
  for (const key of Object.keys(retryCountByCategory)) delete retryCountByCategory[key];
  retriesPerProvision.length = 0;
  retryLatencies.length = 0;
}
