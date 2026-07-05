/**
 * SCB 2.1 Phase 2.5 — Queue metrics (logging + row snapshot).
 */

import { logMachineOperation } from './machine-operation-observability.js';

/**
 * @param {Record<string, unknown>} row
 * @param {{ executionMs?: number; now?: Date }} [options]
 * @returns {Record<string, number|null>}
 */
export function buildOperationMetrics(row, options = {}) {
  const now = options.now ?? new Date();
  const createdAt = row.created_at ? new Date(String(row.created_at)).getTime() : null;
  const startedAt = row.started_at ? new Date(String(row.started_at)).getTime() : null;
  const executionMs = options.executionMs ?? (startedAt != null ? now.getTime() - startedAt : null);
  const queueWaitMs =
    createdAt != null && startedAt != null ? Math.max(0, startedAt - createdAt) : null;

  return {
    queue_wait_ms: queueWaitMs,
    execution_ms: executionMs ?? null,
    provider_ms: null,
    pipeline_ms: null,
    retry_count: Number(row.retry_count ?? row.attempts ?? 0),
    lease_count: Number(row.lease_count ?? 0),
    dead_letter_count: String(row.state ?? '') === 'dead_letter' ? 1 : 0,
    success_rate: String(row.state ?? '') === 'completed' ? 1 : 0,
    failure_rate: ['dead_letter', 'failed'].includes(String(row.state ?? '')) ? 1 : 0,
  };
}

/**
 * @param {Record<string, number|null>} metrics
 * @returns {Record<string, number|null>}
 */
export function mergeMetrics(existing, metrics) {
  const base =
    existing && typeof existing === 'object'
      ? /** @type {Record<string, number|null>} */ (existing)
      : {};
  return { ...base, ...metrics };
}

/**
 * @param {{
 *   processed: number;
 *   completed: number;
 *   retried: number;
 *   deadLetter: number;
 *   failed: number;
 *   selfHeal?: Record<string, number>;
 * }} summary
 */
export function logQueueMetricsSnapshot(summary) {
  const total = summary.processed || 1;
  logMachineOperation(
    'machine-op-metrics',
    {
      correlationId: null,
      operationId: null,
      durationMs: null,
      extra: {
        processed: summary.processed,
        completed: summary.completed,
        retried: summary.retried,
        dead_letter_count: summary.deadLetter,
        failed: summary.failed,
        success_rate: summary.completed / total,
        failure_rate: (summary.deadLetter + summary.failed) / total,
        self_heal: summary.selfHeal ?? null,
      },
    },
    'batch metrics snapshot',
  );
}
