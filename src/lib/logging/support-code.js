/**
 * Customer-facing Support Code helpers.
 * Display: REQ-XXXXXXXX (first 8 hex of UUID)
 * Trace: full requestId (or strip REQ- prefix)
 */

/**
 * @param {string|null|undefined} requestId
 * @returns {string|null}
 */
export function formatSupportCode(requestId) {
  if (!requestId) return null;
  const compact = String(requestId).replace(/-/g, '').replace(/^REQ/i, '').slice(0, 8).toUpperCase();
  if (!compact) return null;
  return `REQ-${compact}`;
}

/**
 * @param {string|null|undefined} codeOrId
 * @returns {string}
 */
export function parseSupportCodeOrRequestId(codeOrId) {
  const raw = String(codeOrId ?? '').trim();
  if (!raw) return '';
  if (/^[0-9a-f-]{36}$/i.test(raw)) return raw;
  const stripped = raw.replace(/^REQ-/i, '').trim();
  if (/^[0-9a-f-]{36}$/i.test(stripped)) return stripped;
  return stripped || raw;
}

/**
 * Fields to attach to API JSON responses.
 * @param {string} requestId
 */
export function supportCodeFields(requestId) {
  return {
    requestId,
    supportCode: formatSupportCode(requestId),
  };
}
