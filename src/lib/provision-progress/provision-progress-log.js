import { randomUUID } from 'node:crypto';
import { logger } from '../logging/index.js';

export function logProvisionProgressEvent(event, fields = {}, message) {
  const requestId = fields.requestId || randomUUID();
  const payload = {
    operation: 'provision.progress',
    event,
    requestId,
    machineId: fields.machineId ?? null,
    gpuSessionId: fields.gpuSessionId ?? null,
    provider: fields.provider ?? null,
    stage: fields.stage ?? null,
    elapsedMs: fields.elapsedMs ?? null,
    estimatedRemainingMs: fields.estimatedRemainingMs ?? null,
    ...fields,
  };
  const text = message ?? event;
  if (event.includes('FAILED')) logger('api').warn(payload, text);
  else logger('api').info(payload, text);
  return requestId;
}