/**
 * In-process Session Resume metrics.
 */

const counters = {
  resumeAttempts: 0,
  resumeSuccess: 0,
  resumeFailures: 0,
  duplicateStartPrevented: 0,
};

/** @type {number[]} */
const resumeDurations = [];

export function incrSessionResumeMetric(name, delta = 1) {
  if (!(name in counters)) return;
  counters[name] += delta;
}

export function recordResumeDurationMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return;
  resumeDurations.push(ms);
  if (resumeDurations.length > 200) resumeDurations.shift();
}

export function getSessionResumeMetrics() {
  const avg =
    resumeDurations.length === 0
      ? null
      : resumeDurations.reduce((a, b) => a + b, 0) / resumeDurations.length;
  return {
    ...counters,
    averageResumeTime: avg != null ? Math.round(avg) : null,
  };
}

export function resetSessionResumeMetrics() {
  counters.resumeAttempts = 0;
  counters.resumeSuccess = 0;
  counters.resumeFailures = 0;
  counters.duplicateStartPrevented = 0;
  resumeDurations.length = 0;
}