/**
 * CF Workers reject fetch() to literal IPs (error 1003).
 * Rewrite http://IPv4:port → http://IPv4-dashed.sslip.io:port for subrequests.
 * Clore hostname upstreams are left unchanged.
 */

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

/**
 * @param {string | undefined | null} hopSuffix from env.COMFY_IP_LITERAL_HOP_SUFFIX
 * @returns {string | null}
 */
export function resolveHopSuffix(hopSuffix) {
  const raw = String(hopSuffix ?? 'sslip.io').trim().toLowerCase();
  if (!raw || raw === 'off' || raw === '0' || raw === 'false' || raw === 'no') return null;
  return raw.replace(/^\./, '');
}

/**
 * @param {string} upstreamBase
 * @param {string | undefined | null} hopSuffix
 * @returns {string}
 */
export function rewriteIpLiteralUpstreamForFetch(upstreamBase, hopSuffix) {
  const raw = String(upstreamBase ?? '').trim().replace(/\/$/, '');
  if (!raw) return raw;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return raw;
  if (!IPV4_RE.test(parsed.hostname)) return raw;

  const suffix = resolveHopSuffix(hopSuffix);
  if (!suffix) return raw;

  parsed.hostname = `${parsed.hostname.replace(/\./g, '-')}.${suffix}`;
  return parsed.toString().replace(/\/$/, '');
}
