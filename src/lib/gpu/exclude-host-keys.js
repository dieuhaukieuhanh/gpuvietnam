/**
 * Match marketplace host keys against dual-run / bad-host exclude lists.
 * Keys may be full (`vast-host:123|rtx4090_1x`), base (`vast-host:123`), or bare id (`123`).
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeExcludeHostToken(value) {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  return text || null;
}

/**
 * @param {unknown} hostKey
 * @returns {Set<string>}
 */
export function hostKeyMatchTokens(hostKey) {
  /** @type {Set<string>} */
  const out = new Set();
  const full = normalizeExcludeHostToken(hostKey);
  if (!full) return out;
  out.add(full);
  const base = full.split('|')[0];
  if (base) out.add(base);
  const colon = base.lastIndexOf(':');
  if (colon >= 0 && colon < base.length - 1) {
    out.add(base.slice(colon + 1));
  }
  return out;
}

/**
 * @param {Iterable<unknown>} [keys]
 * @returns {string[]}
 */
export function normalizeExcludeHostKeys(keys = []) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const key of keys) {
    for (const token of hostKeyMatchTokens(key)) {
      out.add(token);
    }
  }
  return [...out];
}

/**
 * @param {unknown} candidateHostKey
 * @param {Iterable<unknown>} [excludeHostKeys]
 * @returns {boolean}
 */
export function hostKeyIsExcluded(candidateHostKey, excludeHostKeys = []) {
  const candidateTokens = hostKeyMatchTokens(candidateHostKey);
  if (candidateTokens.size === 0) return false;
  const excludeTokens = normalizeExcludeHostKeys(excludeHostKeys);
  if (excludeTokens.length === 0) return false;
  for (const token of excludeTokens) {
    if (candidateTokens.has(token)) return true;
  }
  return false;
}
