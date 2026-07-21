/**
 * API route helpers: resolve / propagate Request ID and wrap handlers.
 */

import { createCorrelationId } from '../scb-correlation.js';
import { runWithLogContext, updateLogContext } from './context.js';
import { logOperation } from './operations.js';
import { logger } from './logger.js';
import { summarizeRequest } from './redact.js';
import { serializeError } from './serialize-error.js';
import { supportCodeFields } from './support-code.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * @param {import('http').IncomingMessage | { headers?: Record<string, string|string[]|undefined> }} req
 * @returns {string}
 */
export function resolveRequestId(req) {
  const headers = req?.headers ?? {};
  const raw =
    headers[REQUEST_ID_HEADER] ??
    headers['X-Request-Id'] ??
    headers['x-correlation-id'] ??
    headers['X-Correlation-Id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return createCorrelationId(typeof value === 'string' ? value.trim() : undefined);
}

/**
 * @param {import('http').ServerResponse} res
 * @param {string} requestId
 */
export function setRequestIdHeader(res, requestId) {
  try {
    if (res && !res.headersSent) {
      res.setHeader(REQUEST_ID_HEADER, requestId);
      res.setHeader('x-correlation-id', requestId);
      const code = supportCodeFields(requestId).supportCode;
      if (code) res.setHeader('x-support-code', code);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Wrap a Pages API handler with request context + START/SUCCESS/FAILURE logs.
 *
 * @param {(req: any, res: any) => any} handler
 * @param {{ operation?: string; channel?: string }} [options]
 * @returns {(req: any, res: any) => Promise<any>}
 */
export function withApiLogging(handler, options = {}) {
  const operation = options.operation ?? 'api.request';
  const channel = options.channel ?? 'api';

  return async function apiLoggingWrapper(req, res) {
    const requestId = resolveRequestId(req);
    setRequestIdHeader(res, requestId);
    const codes = supportCodeFields(requestId);

    return runWithLogContext({ requestId, operation, channel }, async () => {
      const started = Date.now();
      const log = logger('api');
      log.info(
        {
          phase: 'START',
          ...summarizeRequest(req),
          supportCode: codes.supportCode,
        },
        `${operation} START`,
      );

      const originalJson = res.json?.bind(res);
      if (typeof originalJson === 'function') {
        res.json = (body) => {
          if (body && typeof body === 'object' && !Array.isArray(body)) {
            /** @type {Record<string, unknown>} */
            const next = { ...body };
            if (next.requestId == null) next.requestId = requestId;
            if (next.supportCode == null) next.supportCode = codes.supportCode;
            return originalJson(next);
          }
          return originalJson(body);
        };
      }

      try {
        const result = await handler(req, res);
        const durationMs = Date.now() - started;
        const statusCode = res.statusCode || 200;
        if (statusCode >= 500) {
          log.error(
            { phase: 'FAILURE', durationMs, statusCode, supportCode: codes.supportCode },
            `${operation} FAILURE`,
          );
        } else if (statusCode >= 400) {
          log.warn(
            { phase: 'FAILURE', durationMs, statusCode, supportCode: codes.supportCode },
            `${operation} CLIENT_ERROR`,
          );
        } else {
          log.info(
            { phase: 'SUCCESS', durationMs, statusCode, supportCode: codes.supportCode },
            `${operation} SUCCESS`,
          );
        }
        return result;
      } catch (err) {
        const durationMs = Date.now() - started;
        log.error(
          {
            phase: 'FAILURE',
            durationMs,
            supportCode: codes.supportCode,
            err: serializeError(err, { operation, requestId }),
          },
          `${operation} FAILURE`,
        );
        throw err;
      }
    });
  };
}

/**
 * @template T
 * @param {import('./context.js').LogContext} context
 * @param {() => T | Promise<T>} fn
 * @returns {T | Promise<T>}
 */
export function withBackgroundLogContext(context, fn) {
  return runWithLogContext({ channel: context.channel ?? 'worker', ...context }, fn);
}

/**
 * @param {Partial<import('./context.js').LogContext>} patch
 */
export function bindRequestActors(patch) {
  updateLogContext(patch);
}

export { logOperation, supportCodeFields };
