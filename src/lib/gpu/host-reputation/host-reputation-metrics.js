/**
 * In-process host reputation metrics.
 */

const counters = {
  hostSelectionCount: 0,
  hostBlacklistCount: 0,
  hostRecoveryCount: 0,
  hostSuccessCount: 0,
  hostFailureCount: 0,
};

/** @type {Map<string, number>} */
const failureReasons = new Map();

/** @type {number[]} */
const scoreSamples = [];

export function incrHostReputationMetric(name, delta = 1) {
  if (!(name in counters)) return;
  counters[name] += delta;
}

export function recordHostFailureReason(reason) {
  const key = String(reason || 'UNKNOWN');
  failureReasons.set(key, (failureReasons.get(key) || 0) + 1);
}

export function recordHostScoreSample(score) {
  if (!Number.isFinite(score)) return;
  scoreSamples.push(score);
  if (scoreSamples.length > 500) scoreSamples.shift();
}

export function getHostReputationMetrics() {
  const avg =
    scoreSamples.length === 0
      ? 0
      : scoreSamples.reduce((a, b) => a + b, 0) / scoreSamples.length;
  const totalOutcomes = counters.hostSuccessCount + counters.hostFailureCount;
  const topFailureReasons = [...failureReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));
  return {
    ...counters,
    hostSuccessRate: totalOutcomes > 0 ? counters.hostSuccessCount / totalOutcomes : null,
    averageHostScore: Math.round(avg * 10) / 10,
    topFailureReasons,
  };
}

export function resetHostReputationMetrics() {
  counters.hostSelectionCount = 0;
  counters.hostBlacklistCount = 0;
  counters.hostRecoveryCount = 0;
  counters.hostSuccessCount = 0;
  counters.hostFailureCount = 0;
  failureReasons.clear();
  scoreSamples.length = 0;
}
