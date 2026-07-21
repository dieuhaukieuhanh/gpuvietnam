/**
 * Error serialization that preserves stack + cause chain and merges log context.
 */

import { getLogContext } from './context.js';
import { redactValue } from './redact.js';

/**
 * @param {unknown} err
 * @param {{ provider?: string|null; operation?: string|null; requestId?: string|null; depth?: number }} [opts]
 * @returns {Record<string, unknown>}
 */
export function serializeError(err, opts = {}) {
  const depth = opts.depth ?? 0;
  const ctx = getLogContext();
  const requestId = opts.requestId ?? ctx.requestId ?? null;
  const operation = opts.operation ?? ctx.operation ?? null;
  const provider = opts.provider ?? ctx.extra?.provider ?? null;

  if (err == null) {
    return {
      message: String(err),
      requestId,
      operation,
      provider,
    };
  }

  if (!(err instanceof Error) && typeof err === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (err);
    return {
      name: obj.name != null ? String(obj.name) : 'Error',
      message: obj.message != null ? String(obj.message) : JSON.stringify(redactValue(obj)),
      code: obj.code ?? null,
      stack: typeof obj.stack === 'string' ? obj.stack.slice(0, 4000) : undefined,
      requestId,
      operation,
      provider,
      details: redactValue({
        code: obj.code,
        details: obj.details,
        hint: obj.hint,
        status: obj.status ?? obj.statusCode ?? obj.httpStatus,
      }),
    };
  }

  if (!(err instanceof Error)) {
    return {
      name: 'Error',
      message: String(err),
      requestId,
      operation,
      provider,
    };
  }

  /** @type {Record<string, unknown>} */
  const out = {
    name: err.name || 'Error',
    message: err.message,
    stack: typeof err.stack === 'string' ? err.stack.slice(0, 4000) : undefined,
    requestId,
    operation,
    provider,
  };

  const code = /** @type {{ code?: unknown }} */ (err).code;
  if (code != null) out.code = code;

  const status =
    /** @type {{ status?: unknown; statusCode?: unknown; httpStatus?: unknown }} */ (err).status ??
    /** @type {{ statusCode?: unknown }} */ (err).statusCode ??
    /** @type {{ httpStatus?: unknown }} */ (err).httpStatus;
  if (status != null) out.httpStatus = status;

  if ('cause' in err && err.cause != null && depth < 3) {
    out.cause = serializeError(err.cause, { ...opts, depth: depth + 1 });
  }

  return out;
}
