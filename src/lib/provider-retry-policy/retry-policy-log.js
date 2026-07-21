import { randomUUID } from 'node:crypto';
import { logger } from '../logging/index.js';

export function logRetryPolicyEvent(event, fields = {}, message) {
  const requestId = fields.requestId || randomUUID();
  const payload = {
    operation: 'provider.retry_policy',
    event,
    requestId,
    provider: fields.provider ?? null,
    operationName: fields.operation ?? null,
    category: fields.category ?? null,
    errorCode: fields.errorCode ?? null,
    retryCount: fields.retryCount ?? null,
    decision: fields.decision ?? null,
    waitDurationMs: fields.waitDurationMs ?? null,
    ...fields,
  };
  logger('provider').info(payload, message ?? event);
  return requestId;
}
