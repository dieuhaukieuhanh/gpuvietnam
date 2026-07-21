/**
 * START / SUCCESS / FAILURE operation helpers with durationMs.
 */

import { logger } from './logger.js';
import { runWithLogContext, updateLogContext } from './context.js';
import { normalizeChannel } from './channels.js';
import { serializeError } from './serialize-error.js';

/**
 * @typedef {Object} OperationOptions
 * @property {string} [channel]
 * @property {string} [requestId]
 * @property {string} [userId]
 * @property {string} [machineId]
 * @property {string} [gpuSessionId]
 * @property {string} [subscriptionId]
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @template T
 * @param {string} operation
 * @param {() => T | Promise<T>} fn
 * @param {OperationOptions} [options]
 * @returns {Promise<T>}
 */
export async function logOperation(operation, fn, options = {}) {
  const channel = normalizeChannel(options.channel ?? 'app');
  const log = logger(channel);
  const started = Date.now();
  const baseMeta = { ...(options.meta ?? {}) };

  return runWithLogContext(
    {
      operation,
      channel,
      requestId: options.requestId,
      userId: options.userId,
      machineId: options.machineId,
      gpuSessionId: options.gpuSessionId,
      subscriptionId: options.subscriptionId,
    },
    async () => {
      log.info({ ...baseMeta, phase: 'START' }, `${operation} START`);
      try {
        const result = await fn();
        const durationMs = Date.now() - started;
        log.info({ ...baseMeta, phase: 'SUCCESS', durationMs }, `${operation} SUCCESS`);
        return result;
      } catch (err) {
        const durationMs = Date.now() - started;
        log.error(
          {
            ...baseMeta,
            phase: 'FAILURE',
            durationMs,
            err: serializeError(err, {
              operation,
              requestId: options.requestId,
              provider: /** @type {any} */ (baseMeta).provider,
            }),
          },
          `${operation} FAILURE`,
        );
        throw err;
      }
    },
  );
}

/**
 * @param {string} operation
 * @param {'START'|'SUCCESS'|'FAILURE'} phase
 * @param {OperationOptions & { durationMs?: number; err?: unknown }} [options]
 */
export function logPhase(operation, phase, options = {}) {
  const channel = normalizeChannel(options.channel ?? 'app');
  const log = logger(channel);
  if (options.requestId || options.userId || options.machineId) {
    updateLogContext({
      operation,
      requestId: options.requestId,
      userId: options.userId,
      machineId: options.machineId,
      gpuSessionId: options.gpuSessionId,
      subscriptionId: options.subscriptionId,
      channel,
    });
  }

  /** @type {Record<string, unknown>} */
  const meta = {
    operation,
    phase,
    ...(options.meta ?? {}),
  };
  if (options.durationMs != null) meta.durationMs = options.durationMs;
  if (phase === 'FAILURE' && options.err != null) {
    meta.err = serializeError(options.err, {
      operation,
      requestId: options.requestId,
      provider: /** @type {any} */ (options.meta)?.provider,
    });
    log.error(meta, `${operation} ${phase}`);
    return;
  }
  log.info(meta, `${operation} ${phase}`);
}
