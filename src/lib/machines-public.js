/**
 * machines.image (and related secrets) are admin-audit / ops only.
 * Customer-facing API payloads must never include these fields.
 */

/** @type {readonly string[]} */
export const MACHINE_CUSTOMER_DENYLIST = Object.freeze([
  'image',
  'ssh_password',
  'backup_flush_secret',
]);

/**
 * Strip internal machine fields before sending JSON to customers.
 * Safe to call on DTOs or accidental raw row spreads.
 * @template {Record<string, unknown>} T
 * @param {T | null | undefined} payload
 * @returns {T | null | undefined}
 */
export function scrubMachineForCustomer(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  /** @type {Record<string, unknown>} */
  const next = { ...payload };
  for (const key of MACHINE_CUSTOMER_DENYLIST) {
    if (key in next) delete next[key];
  }
  return /** @type {T} */ (next);
}

/**
 * @param {unknown} payload
 * @returns {boolean}
 */
export function customerPayloadHasMachineInternals(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return MACHINE_CUSTOMER_DENYLIST.some((key) =>
    Object.prototype.hasOwnProperty.call(payload, key),
  );
}
