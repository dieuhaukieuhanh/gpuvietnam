/**
 * Structured SCB lifecycle transition diagnostics.
 */

import { logger } from './logger.js';
import { getLogContext } from './context.js';

/**
 * @param {{
 *   command?: string|null;
 *   resultState?: string|null;
 *   stateBefore?: string|null;
 *   stateAfter?: string|null;
 *   gpuSessionId?: string|null;
 *   machineOperationId?: string|null;
 *   machineId?: string|null;
 *   projectionVersion?: string|number|null;
 *   settlementVersion?: string|number|null;
 *   event?: string|null;
 *   extra?: Record<string, unknown>;
 * }} fields
 */
export function logScbTransition(fields) {
  const ctx = getLogContext();
  logger('app').info(
    {
      operation: 'scb.transition',
      command: fields.command ?? null,
      resultState: fields.resultState ?? null,
      stateBefore: fields.stateBefore ?? null,
      stateAfter: fields.stateAfter ?? null,
      gpuSessionId: fields.gpuSessionId ?? ctx.gpuSessionId ?? null,
      machineOperationId: fields.machineOperationId ?? ctx.extra?.machineOperationId ?? null,
      machineId: fields.machineId ?? ctx.machineId ?? null,
      projectionVersion: fields.projectionVersion ?? ctx.extra?.projectionVersion ?? null,
      settlementVersion: fields.settlementVersion ?? ctx.extra?.settlementVersion ?? null,
      event: fields.event ?? null,
      ...(fields.extra ?? {}),
    },
    `scb.transition ${fields.command ?? '?'} ${fields.stateBefore ?? 'null'}->${fields.stateAfter ?? 'null'}`,
  );
}
