/**
 * Cloudflare Workers cannot fetch() literal IP URLs (error 1003).
 * Clore upstreams are hostnames (*.clorecloud.net) so they work.
 * Vast upstreams are http://IP:HostPort — rewrite IPv4 host to a DNS
 * name that resolves back to the same IP (default: sslip.io).
 *
 * Browser never sees this URL (brand proxy only). Stored in token/KV
 * for the Worker fetch hop.
 */

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

/**
 * @param {string} host
 * @returns {boolean}
 */
export function isIpv4Hostname(host) {
  return IPV4_RE.test(String(host ?? '').trim());
}

/**
 * Hop suffix without leading dot. Empty / "off" / "0" disables rewrite.
 * @returns {string | null}
 */
export function resolveComfyIpLiteralHopSuffix() {
  const raw = String(process.env.COMFY_IP_LITERAL_HOP_SUFFIX ?? 'sslip.io').trim().toLowerCase();
  if (!raw || raw === 'off' || raw === '0' || raw === 'false' || raw === 'no') return null;
  return raw.replace(/^\./, '');
}

/**
 * @param {string} ipv4
 * @param {string} suffix
 */
export function ipv4ToHopHostname(ipv4, suffix) {
  const ip = String(ipv4).trim();
  const suf = String(suffix).trim().replace(/^\./, '');
  // Dashed form avoids ambiguous multi-label IP.nip.io parsing edge cases.
  return `${ip.replace(/\./g, '-')}.${suf}`;
}

/**
 * If upstream is http(s)://IPv4[:port], rewrite host for Worker-fetchable DNS.
 * Clore hostnames and non-IP hosts are unchanged.
 *
 * @param {string | null | undefined} upstreamUrl
 * @param {{ hopSuffix?: string | null }} [options]
 * @returns {string | null}
 */
export function rewriteIpLiteralUpstreamForFetch(upstreamUrl, options = {}) {
  const raw = String(upstreamUrl ?? '').trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw.replace(/\/$/, '') || null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return raw.replace(/\/$/, '') || null;
  }

  const host = parsed.hostname;
  if (!isIpv4Hostname(host)) {
    return raw.replace(/\/$/, '') || null;
  }

  const suffix =
    options.hopSuffix !== undefined
      ? options.hopSuffix
      : resolveComfyIpLiteralHopSuffix();
  if (!suffix) {
    return raw.replace(/\/$/, '') || null;
  }

  parsed.hostname = ipv4ToHopHostname(host, suffix);
  return parsed.toString().replace(/\/$/, '');
}
