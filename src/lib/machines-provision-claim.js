/**
 * CAS claim helpers for start-machine (offline -> provisioning) with lease ownership.
 * Kept separate from machines.js to avoid circular imports with lifecycle persist.
 */

import {
  buildProvisionLeasePatch,
  clearedProvisionLeaseFields,
  isProvisionLeaseExpired,
} from './provision-lease.js';
import {
  LEASE_SELECT_COLS,
  LEGACY_STALE_PROVISIONING_CLAIM_MS,
} from './provision-lease-config.js';
import { logProvisionLeaseEvent } from './provision-lease-log.js';
import { incrProvisionLeaseMetric } from './provision-lease-metrics.js';

export { isProvisionLeaseExpired, clearedProvisionLeaseFields };
export { LEASE_SELECT_COLS as PROVISION_LEASE_SELECT_COLS };

/**
 * CAS claim: offline -> provisioning with a new lease. Only one concurrent start wins.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} subscriptionId
 * @param {{
 *   plan?: string;
 *   gpu_label?: string;
 *   nowIso?: string;
 *   ownerId?: string;
 *   leaseId?: string;
 *   requestId?: string | null;
 * }} [extras]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function claimSubscriptionForProvision(supabaseAdmin, subscriptionId, extras = {}) {
  const { patch, leaseId, ownerId } = buildProvisionLeasePatch({
    nowIso: extras.nowIso,
    ownerId: extras.ownerId,
    leaseId: extras.leaseId,
    plan: extras.plan,
    gpu_label: extras.gpu_label,
  });

  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .update(patch)
    .eq('id', subscriptionId)
    .eq('server_status', 'offline')
    .select(LEASE_SELECT_COLS)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  incrProvisionLeaseMetric('leaseCreated');
  const expiresMs = Date.parse(String(data.provisioning_lease_expires_at));
  logProvisionLeaseEvent(
    'LEASE_CREATED',
    {
      requestId: extras.requestId,
      leaseId,
      ownerId,
      subscriptionId,
      remainingLeaseMs: Number.isFinite(expiresMs) ? expiresMs - Date.now() : null,
    },
    'Provision lease created',
  );
  return data;
}

/**
 * Reclaim an expired provisioning lease (no active heartbeat owner).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} subscriptionId
 * @param {{
 *   staleBeforeIso?: string;
 *   plan?: string;
 *   gpu_label?: string;
 *   nowIso?: string;
 *   ownerId?: string;
 *   leaseId?: string;
 *   requestId?: string | null;
 * }} [options]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function reclaimStaleProvisionClaim(supabaseAdmin, subscriptionId, options = {}) {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const { patch, leaseId, ownerId } = buildProvisionLeasePatch({
    nowIso,
    ownerId: options.ownerId,
    leaseId: options.leaseId,
    plan: options.plan,
    gpu_label: options.gpu_label,
  });

  const staleBeforeIso =
    options.staleBeforeIso ??
    new Date(Date.now() - LEGACY_STALE_PROVISIONING_CLAIM_MS).toISOString();

  let { data, error } = await supabaseAdmin
    .from('subscriptions')
    .update(patch)
    .eq('id', subscriptionId)
    .eq('server_status', 'provisioning')
    .lt('provisioning_lease_expires_at', nowIso)
    .select(LEASE_SELECT_COLS)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const legacy = await supabaseAdmin
      .from('subscriptions')
      .update(patch)
      .eq('id', subscriptionId)
      .eq('server_status', 'provisioning')
      .is('provisioning_lease_expires_at', null)
      .lt('provisioning_started_at', staleBeforeIso)
      .select(LEASE_SELECT_COLS)
      .maybeSingle();
    if (legacy.error) throw legacy.error;
    data = legacy.data;
  }

  if (!data) return null;

  incrProvisionLeaseMetric('leaseRecovered');
  const expiresMs = Date.parse(String(data.provisioning_lease_expires_at));
  logProvisionLeaseEvent(
    'LEASE_RECOVERED',
    {
      requestId: options.requestId,
      leaseId,
      ownerId,
      subscriptionId,
      remainingLeaseMs: Number.isFinite(expiresMs) ? expiresMs - Date.now() : null,
    },
    'Expired provision lease recovered',
  );
  return data;
}

/**
 * @param {{ userId: string; subscriptionId: string; correlationId: string }} parts
 */
export function buildProvisionAttemptLabel(parts) {
  const user = String(parts.userId ?? '').replace(/-/g, '').slice(0, 8);
  const sub = String(parts.subscriptionId ?? '').replace(/-/g, '').slice(0, 8);
  const corr = String(parts.correlationId ?? '').replace(/-/g, '').slice(0, 8);
  return ('gv-' + user + '-' + sub + '-' + corr).slice(0, 64);
}
