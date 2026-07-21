/**
 * Structured Session Resume logging.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../logging/index.js';

/**
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 * @param {string} [message]
 */
export function logSessionResumeEvent(event, fields = {}, message) {
  const requestId = fields.requestId || randomUUID();
  const payload = {
    operation: 'session.resume',
    event,
    requestId,
    machineId: fields.machineId ?? null,
    gpuSessionId: fields.gpuSessionId ?? null,
    provider: fields.provider ?? null,
    currentState: fields.currentState ?? null,
    resumeDurationMs: fields.resumeDurationMs ?? null,
    ...fields,
  };
  const text = message ?? event;
  if (event.includes('FAILED')) {
    logger('api').warn(payload, text);
  } else {
    logger('api').info(payload, text);
  }
  return requestId;
}