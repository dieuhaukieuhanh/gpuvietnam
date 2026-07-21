const stageDurations = new Map();
const failedStages = new Map();
/** @type {number[]} */
const provisionDurations = [];

export function recordStageDuration(stage, ms) {
  if (!stage || !Number.isFinite(ms) || ms < 0) return;
  const key = String(stage);
  const arr = stageDurations.get(key) || [];
  arr.push(ms);
  if (arr.length > 100) arr.shift();
  stageDurations.set(key, arr);
}

export function recordFailedStage(stage) {
  const key = String(stage || 'UNKNOWN');
  failedStages.set(key, (failedStages.get(key) || 0) + 1);
}

export function recordProvisionDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return;
  provisionDurations.push(ms);
  if (provisionDurations.length > 100) provisionDurations.shift();
}

function avg(arr) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

export function getProvisionProgressMetrics() {
  /** @type {Record<string, number>} */
  const averageDurationPerStage = {};
  for (const [stage, samples] of stageDurations.entries()) {
    const a = avg(samples);
    if (a != null) averageDurationPerStage[stage] = a;
  }
  const slowestStages = Object.entries(averageDurationPerStage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([stage, avgMs]) => ({ stage, avgMs }));
  const failed = [...failedStages.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([stage, count]) => ({ stage, count }));
  return {
    averageDurationPerStage,
    slowestStages,
    failedStages: failed,
    averageProvisionDuration: avg(provisionDurations),
  };
}

export function resetProvisionProgressMetrics() {
  stageDurations.clear();
  failedStages.clear();
  provisionDurations.length = 0;
}