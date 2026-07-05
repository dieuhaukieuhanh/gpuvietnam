/**
 * Diagnostic trace for projection_verify worker lifecycle (read-only logging).
 */

/**
 * @typedef {Object} ProjectionVerifyTraceContext
 * @property {string|null} [operationId]
 * @property {string|null} [correlationId]
 * @property {string|null} [userId]
 * @property {string|null} [machineId]
 */

/**
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {ProjectionVerifyTraceContext}
 */
export function createProjectionVerifyTraceContext(row) {
  if (!row) {
    return {
      operationId: null,
      correlationId: null,
      userId: null,
      machineId: null,
    };
  }

  return {
    operationId: row.id != null ? String(row.id) : null,
    correlationId: row.correlation_id != null ? String(row.correlation_id) : null,
    userId: row.user_id != null ? String(row.user_id) : null,
    machineId: row.machine_id != null ? String(row.machine_id) : null,
  };
}

/**
 * @param {string} checkpoint
 * @param {ProjectionVerifyTraceContext|null|undefined} ctx
 * @param {Record<string, unknown>} [payload]
 */
export function logProjectionVerifyTrace(checkpoint, ctx, payload = {}) {
  console.info('[scb-pv-trace]', {
    checkpoint,
    operation_id: ctx?.operationId ?? null,
    correlation_id: ctx?.correlationId ?? null,
    user_id: ctx?.userId ?? null,
    machine_id: ctx?.machineId ?? null,
    ts: new Date().toISOString(),
    ...payload,
  });
}
