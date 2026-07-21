/**
 * Normalize searchable provider diagnostic fields for Vast / Clore logs.
 */

/**
 * @typedef {Object} ProviderDiagFields
 * @property {string|null} [provider]
 * @property {string|number|null} [offerId]
 * @property {string|number|null} [instanceId]
 * @property {string|number|null} [machineId]
 * @property {string|null} [gpuType]
 * @property {number|null} [gpuCount]
 * @property {string|null} [region]
 * @property {number|null} [retryCount]
 * @property {number|null} [httpStatus]
 * @property {number|null} [providerLatencyMs]
 */

/**
 * @param {ProviderDiagFields & Record<string, unknown>} [fields]
 * @returns {Record<string, unknown>}
 */
export function providerDiag(fields = {}) {
  /** @type {Record<string, unknown>} */
  const out = {};
  const keys = [
    'provider',
    'offerId',
    'instanceId',
    'machineId',
    'gpuType',
    'gpuCount',
    'region',
    'retryCount',
    'httpStatus',
    'providerLatencyMs',
  ];
  for (const key of keys) {
    if (fields[key] !== undefined && fields[key] !== null && fields[key] !== '') {
      out[key] = fields[key];
    }
  }
  for (const [k, v] of Object.entries(fields)) {
    if (keys.includes(k)) continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}
