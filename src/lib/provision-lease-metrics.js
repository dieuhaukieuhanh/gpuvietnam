const counters = {
  leaseCreated: 0,
  leaseHeartbeat: 0,
  leaseRecovered: 0,
  leaseExpired: 0,
  leaseReleased: 0,
};

/** @type {number[]} */
const durationsMs = [];

export function incrProvisionLeaseMetric(name, delta = 1) {
  if (!(name in counters)) return;
  counters[name] += delta;
}

export function recordLeaseDurationMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return;
  durationsMs.push(ms);
  if (durationsMs.length > 500) durationsMs.shift();
}

export function getProvisionLeaseMetrics() {
  const avg =
    durationsMs.length === 0
      ? 0
      : durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length;
  return {
    ...counters,
    averageLeaseDuration: Math.round(avg),
    sampleCount: durationsMs.length,
  };
}

export function resetProvisionLeaseMetrics() {
  counters.leaseCreated = 0;
  counters.leaseHeartbeat = 0;
  counters.leaseRecovered = 0;
  counters.leaseExpired = 0;
  counters.leaseReleased = 0;
  durationsMs.length = 0;
}
