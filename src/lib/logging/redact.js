/**
 * Deep redaction of secrets and truncation of oversized / binary-like values.
 */

const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|session|session[_-]?token|api[_-]?key|apikey|private[_-]?key|client[_-]?secret|bearer|jwt|x-api-key|vast[_-]?ai[_-]?key|vast[_-]?api[_-]?key|clore[_-]?api[_-]?key|aws[_-]?secret|ssh[_-]?key)$/i;

const SENSITIVE_IN_KEY =
  /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|bearer|cookie|jwt|credential)/i;

const REDACTED = '[REDACTED]';
const MAX_STRING = Number(process.env.LOG_MAX_STRING_CHARS || 500);
const MAX_DEPTH = 6;
const MAX_ARRAY = 20;
const MAX_KEYS = 40;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function looksBase64OrBinary(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 200) return false;
  if (/^data:[^;]+;base64,/i.test(value)) return true;
  if (value.length > 2000 && /^[A-Za-z0-9+/\n\r=]+$/.test(value.slice(0, 400))) return true;
  let nonPrint = 0;
  const sample = value.slice(0, 200);
  for (let i = 0; i < sample.length; i += 1) {
    const c = sample.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32)) nonPrint += 1;
  }
  return nonPrint > 8;
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isSensitiveKey(key) {
  return SENSITIVE_KEY.test(key) || SENSITIVE_IN_KEY.test(key);
}

/**
 * @param {unknown} value
 * @param {number} [depth]
 * @param {string} [key]
 * @returns {unknown}
 */
export function redactValue(value, depth = 0, key = '') {
  if (key && isSensitiveKey(key)) return REDACTED;
  if (value == null) return value;
  if (typeof value === 'string') {
    if (looksBase64OrBinary(value)) {
      return `[OMITTED:${value.length}chars:binary-or-base64]`;
    }
    if (/^Bearer\s+/i.test(value)) return 'Bearer [REDACTED]';
    if (value.length > MAX_STRING) {
      return `${value.slice(0, MAX_STRING)}…[truncated:${value.length}]`;
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return '[Function]';
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(value)) {
    return `[Buffer:${value.length}]`;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactValue(value.message, depth + 1, 'message'),
      stack: typeof value.stack === 'string' ? value.stack.slice(0, 4000) : undefined,
    };
  }
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  if (Array.isArray(value)) {
    const sliced = value.slice(0, MAX_ARRAY);
    const out = sliced.map((item, i) => redactValue(item, depth + 1, String(i)));
    if (value.length > MAX_ARRAY) out.push(`[+${value.length - MAX_ARRAY} more]`);
    return out;
  }
  if (typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    const keys = Object.keys(value);
    const limit = keys.slice(0, MAX_KEYS);
    for (const k of limit) {
      out[k] = redactValue(/** @type {Record<string, unknown>} */ (value)[k], depth + 1, k);
    }
    if (keys.length > MAX_KEYS) out._omittedKeys = keys.length - MAX_KEYS;
    return out;
  }
  return String(value);
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
export function redactObject(obj) {
  return /** @type {Record<string, unknown>} */ (redactValue(obj, 0, '') ?? {});
}

/**
 * Safe summary of HTTP request metadata (never secrets or bodies).
 * @param {{ method?: string; url?: string; headers?: Record<string, unknown> }} req
 */
export function summarizeRequest(req) {
  const headers = req?.headers ?? {};
  const contentType = headers['content-type'] ?? headers['Content-Type'] ?? null;
  const contentLength = headers['content-length'] ?? headers['Content-Length'] ?? null;
  return {
    method: req?.method ?? null,
    url: typeof req?.url === 'string' ? req.url.split('?')[0] : null,
    contentType: contentType ? String(contentType).slice(0, 80) : null,
    contentLength: contentLength != null ? Number(contentLength) || String(contentLength) : null,
    hasAuthorization: Boolean(headers.authorization || headers.Authorization),
    hasCookie: Boolean(headers.cookie || headers.Cookie),
  };
}
