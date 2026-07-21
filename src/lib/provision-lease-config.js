/**
 * Provision lease + heartbeat configuration.
 */

function envMs(name, fallback) {
  const raw = Number(process.env[name] ?? fallback);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** How long a lease remains valid after create/heartbeat (default 90s). */
export const PROVISION_LEASE_MS = envMs('PROVISION_LEASE_MS', 90_000);

/** Auto-renew interval while provisioning is active (default 25s). */
export const PROVISION_HEARTBEAT_MS = envMs('PROVISION_HEARTBEAT_MS', 25_000);

/**
 * Max idle since last heartbeat before reclaim (default = lease duration).
 * Used with lease_expires_at for dual-check safety.
 */
export const PROVISION_MAX_IDLE_MS = envMs('PROVISION_MAX_IDLE_MS', PROVISION_LEASE_MS);

/**
 * Legacy fallback when lease columns are null (pre-migration rows).
 * Kept for backward compatibility; new claims always set lease_expires_at.
 */
export const LEGACY_STALE_PROVISIONING_CLAIM_MS = envMs(
  'LEGACY_STALE_PROVISIONING_CLAIM_MS',
  3 * 60 * 1000,
);

/** @deprecated Prefer lease expiry — alias for legacy callers. */
export const STALE_PROVISIONING_CLAIM_MS = LEGACY_STALE_PROVISIONING_CLAIM_MS;

export const LEASE_SELECT_COLS =
  'id, server_status, provisioning_started_at, provisioning_lease_id, provisioning_lease_expires_at, provisioning_heartbeat_at, provisioning_lease_owner, plan, gpu_label';
