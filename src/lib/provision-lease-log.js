import { randomUUID } from 'node:crypto';
import { logger } from './logging/index.js';

/**
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 * @param {string} [message]
 */
export function logProvisionLeaseEvent(event, fields = {}, message) {
  const requestId = fields.requestId || randomUUID();
  const payload = {
    operation: 'provision.lease',
    event,
    requestId,
    leaseId: fields.leaseId ?? null,
    provider: fields.provider ?? null,
    machineId: fields.machineId ?? null,
    gpuSessionId: fields.gpuSessionId ?? null,
    remainingLeaseMs: fields.remainingLeaseMs ?? null,
    subscriptionId: fields.subscriptionId ?? null,
    ownerId: fields.ownerId ?? null,
    ...fields,
  };
  const text = message ?? event;
  if (event.includes('EXPIRED') || event.includes('FAILED')) {
    logger('api').warn(payload, text);
  } else {
    logger('api').info(payload, text);
  }
  return requestId;
}
