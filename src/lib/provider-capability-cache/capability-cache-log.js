import { randomUUID } from 'node:crypto';
import { logger } from '../logging/index.js';

export function logCapabilityCacheEvent(event, fields = {}, message) {
  const requestId = fields.requestId || randomUUID();
  const payload = {
    operation: 'provider.capability_cache',
    event,
    requestId,
    provider: fields.provider ?? null,
    cacheType: fields.cacheType ?? null,
    ageMs: fields.ageMs ?? null,
    ttlMs: fields.ttlMs ?? null,
    ...fields,
  };
  logger('provider').info(payload, message ?? event);
  return requestId;
}