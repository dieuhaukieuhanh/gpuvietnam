/**
 * SCB 2.1 Phase 2.5 — Standardized machine operation logs.
 */

import { logger } from '../logging/index.js';

/**
 * @typedef {Object} MachineOperationLogContext
 * @property {string|null|undefined} [correlationId]
 * @property {string|null|undefined} [operationId]
 * @property {string|null|undefined} [machineId]
 * @property {string|null|undefined} [provider]
 * @property {string|null|undefined} [state]
 * @property {number|null|undefined} [attempt]
 * @property {number|null|undefined} [durationMs]
 * @property {string|null|undefined} [operation]
 * @property {Record<string, unknown>} [extra]
 */

/**
 * @param {string} scope
 * @param {MachineOperationLogContext} ctx
 * @param {string} message
 */
export function logMachineOperation(scope, ctx, message) {
  const payload = {
    requestId: ctx.correlationId ?? null,
    correlation_id: ctx.correlationId ?? null,
    operation_id: ctx.operationId ?? null,
    machineId: ctx.machineId ?? null,
    machine_id: ctx.machineId ?? null,
    provider: ctx.provider ?? null,
    state: ctx.state ?? null,
    attempt: ctx.attempt ?? null,
    durationMs: ctx.durationMs ?? null,
    duration_ms: ctx.durationMs ?? null,
    operation: ctx.operation ?? scope,
    ...(ctx.extra ?? {}),
  };

  logger('worker').info(payload, message);
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {MachineOperationLogContext}
 */
export function logContextFromOperationRow(row) {
  if (!row) {
    return { correlationId: null, operationId: null };
  }

  return {
    correlationId: row.correlation_id ? String(row.correlation_id) : null,
    operationId: row.id ? String(row.id) : null,
    machineId: row.machine_id ? String(row.machine_id) : null,
    provider: row.provider ? String(row.provider) : null,
    state: row.state ? String(row.state) : null,
    attempt: row.attempts != null ? Number(row.attempts) : null,
    operation: row.operation ? String(row.operation) : null,
  };
}
