/**
 * Structured host-reputation logging.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../../logging/index.js';

/**
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 * @param {string} [message]
 */
export function logHostReputationEvent(event, fields = {}, message) {
  const requestId = fields.requestId || randomUUID();
  const payload = {
    operation: 'host.reputation',
    event,
    requestId,
    provider: fields.provider ?? null,
    hostId: fields.hostId ?? null,
    serverId: fields.serverId ?? null,
    gpuType: fields.gpuType ?? null,
    gpuLine: fields.gpuLine ?? null,
    reason: fields.reason ?? null,
    oldScore: fields.oldScore ?? null,
    newScore: fields.newScore ?? null,
    blacklistUntil: fields.blacklistUntil ?? null,
    readyLatencyMs: fields.readyLatencyMs ?? null,
    ...fields,
  };
  const text = message ?? event;
  if (event.includes('BLACKLIST') || event.includes('SKIPPED')) {
    logger('provider').warn(payload, text);
  } else {
    logger('provider').info(payload, text);
  }
  return requestId;
}