/**
 * Stable host keys for Vast / Clore marketplace hosts (GPU-line scoped).
 *
 * Format: `{provider}-host:{hostId}|{gpuLine}`
 * Legacy (no gpuLine): `{provider}-host:{hostId}`
 */

/**
 * @param {unknown} gpuLine
 * @returns {string}
 */
export function normalizeGpuLine(gpuLine) {
  return String(gpuLine ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/**
 * @param {string} provider
 * @param {string|number} hostId
 * @param {string|null|undefined} [gpuLine]
 * @returns {string | null}
 */
export function buildHostReputationKey(provider, hostId, gpuLine = null) {
  const p = String(provider ?? '').trim().toLowerCase();
  const id = String(hostId ?? '').trim();
  if (!p || !id) return null;
  const line = normalizeGpuLine(gpuLine);
  const base = p + '-host:' + id;
  return line ? base + '|' + line : base;
}

/**
 * Attach / replace gpuLine on an existing host key.
 * @param {string | null | undefined} hostKey
 * @param {string|null|undefined} gpuLine
 * @returns {string | null}
 */
export function withGpuLine(hostKey, gpuLine) {
  const parsed = parseHostKey(hostKey);
  if (!parsed) return hostKey != null && String(hostKey).trim() ? String(hostKey).trim() : null;
  return buildHostReputationKey(parsed.provider, parsed.hostId, gpuLine || parsed.gpuLine);
}

/**
 * @param {Record<string, unknown> | null | undefined} record
 * @param {string|null|undefined} [gpuLine]
 * @returns {string | null}
 */
export function resolveVastHostKey(record, gpuLine = null) {
  if (!record || typeof record !== 'object') return null;
  const candidates = [
    record.machine_id,
    record.host_id,
    record.machineId,
    record.hostId,
    record.machine && typeof record.machine === 'object'
      ? /** @type {Record<string, unknown>} */ (record.machine).id
      : null,
  ];
  for (const value of candidates) {
    if (value == null || value === '') continue;
    const key = String(value).trim();
    if (key) return buildHostReputationKey('vast', key, gpuLine);
  }
  return null;
}

/**
 * @param {unknown} payload
 * @returns {string}
 */
function extractServerId(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const rec = /** @type {Record<string, unknown>} */ (payload);
  const sid = rec.renting_server ?? rec.si ?? rec.server_id ?? '';
  return sid != null && String(sid).trim() ? String(sid).trim() : '';
}

/**
 * @param {Record<string, unknown> | null | undefined} record
 * @param {string|number|null} [serverIdHint]
 * @param {string|null|undefined} [gpuLine]
 * @returns {string | null}
 */
export function resolveCloreHostKey(record, serverIdHint = null, gpuLine = null) {
  if (serverIdHint != null && String(serverIdHint).trim()) {
    return buildHostReputationKey('clore', String(serverIdHint).trim(), gpuLine);
  }
  if (!record || typeof record !== 'object') return null;
  const fromOrder = extractServerId(record);
  if (fromOrder) return buildHostReputationKey('clore', fromOrder, gpuLine);
  if (record.id != null && record.order_id == null) {
    const id = String(record.id).trim();
    if (id) return buildHostReputationKey('clore', id, gpuLine);
  }
  return null;
}

/**
 * @param {string | null | undefined} hostKey
 * @returns {{ provider: string; hostId: string; gpuLine: string | null } | null}
 */
export function parseHostKey(hostKey) {
  const raw = String(hostKey ?? '');
  const match = raw.match(/^(vast|clore)-host:([^|]+)(?:\|(.+))?$/i);
  if (!match) return null;
  return {
    provider: match[1].toLowerCase(),
    hostId: match[2],
    gpuLine: match[3] ? String(match[3]) : null,
  };
}