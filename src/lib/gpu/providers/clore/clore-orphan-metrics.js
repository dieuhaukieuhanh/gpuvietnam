/**
 * In-process counters for Clore orphan-order recovery.
 * Easy to scrape later for Prometheus / admin dashboards.
 */

/** @type {{
 *   orphanDetected: number;
 *   orphanRecovered: number;
 *   orphanCancelled: number;
 *   orphanReconnectSuccess: number;
 *   orphanReconnectFailure: number;
 * }} */
const counters = {
  orphanDetected: 0,
  orphanRecovered: 0,
  orphanCancelled: 0,
  orphanReconnectSuccess: 0,
  orphanReconnectFailure: 0,
};

/**
 * @param {keyof typeof counters} name
 * @param {number} [delta]
 */
export function incrCloreOrphanMetric(name, delta = 1) {
  if (!(name in counters)) return;
  counters[name] += delta;
}

/** @returns {Readonly<typeof counters>} */
export function getCloreOrphanMetrics() {
  return { ...counters };
}

/** Test helper */
export function resetCloreOrphanMetrics() {
  counters.orphanDetected = 0;
  counters.orphanRecovered = 0;
  counters.orphanCancelled = 0;
  counters.orphanReconnectSuccess = 0;
  counters.orphanReconnectFailure = 0;
}
