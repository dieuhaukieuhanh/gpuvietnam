/**
 * Structured orphan-lifecycle logging (provider channel).
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../../../logging/index.js';

/**
 * @typedef {{
 *   requestId?: string | null;
 *   provider?: string;
 *   orderId?: string | null;
 *   serverId?: string | null;
 *   machineId?: string | null;
 *   gpuSessionId?: string | null;
 *   elapsedTime?: number | null;
 *   recoveryAction?: string | null;
 *   [key: string]: unknown;
 * }} CloreOrphanLogFields
 */

/**
 * @param {string} event
 *   ORPHAN_DETECTED | ORPHAN_RECHECK | ORPHAN_CANCEL_STARTED |
 *   ORPHAN_CANCEL_SUCCESS | ORPHAN_CANCEL_FAILED | ORPHAN_RECONNECT_* | ORDER_ID_RECOVERY_*
 * @param {CloreOrphanLogFields} fields
 * @param {string} [message]
 */
export function logCloreOrphanEvent(event, fields = {}, message) {
  const requestId = fields.requestId || randomUUID();
  const payload = {
    operation: 'clore.orphan',
    event,
    requestId,
    provider: fields.provider ?? 'clore',
    orderId: fields.orderId ?? null,
    serverId: fields.serverId ?? null,
    machineId: fields.machineId ?? null,
    gpuSessionId: fields.gpuSessionId ?? null,
    elapsedTime: fields.elapsedTime ?? null,
    recoveryAction: fields.recoveryAction ?? null,
    ...fields,
  };
  const text = message ?? event;
  if (event.endsWith('_FAILED') || event.includes('FAILURE')) {
    logger('provider').error(payload, text);
  } else if (event.includes('DETECTED') || event.includes('CANCEL')) {
    logger('provider').warn(payload, text);
  } else {
    logger('provider').info(payload, text);
  }
  return requestId;
}
