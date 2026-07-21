/**
 * Lease-based provisioning claims with heartbeat renewal.
 *
 * Source of truth for reclaim: provisioning_lease_expires_at (extended by heartbeat).
 * Legacy rows without lease columns fall back to provisioning_started_at age.
 */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  LEASE_SELECT_COLS,
  LEGACY_STALE_PROVISIONING_CLAIM_MS,
  PROVISION_HEARTBEAT_MS,
  PROVISION_LEASE_MS,
  PROVISION_MAX_IDLE_MS,
} from './provision-lease-config.js';
import { logProvisionLeaseEvent } from './provision-lease-log.js';
import {
  getProvisionLeaseMetrics,
  incrProvisionLeaseMetric,
  recordLeaseDurationMs,
} from './provision-lease-metrics.js';

/**
 * @returns {string}
 */
export function createProvisionOwnerId() {
  const host = String(hostname() || 'host')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 24);
  return ('w-' + process.pid + '-' + host + '-' + randomUUID().replace(/-/g, '').slice(0, 8)).slice(0, 64);
}

/**
 * @param {number} [leaseMs]
 * @param {number} [nowMs]
 */
export function computeLeaseExpiresAt(leaseMs = PROVISION_LEASE_MS, nowMs = Date.now()) {
  return new Date(nowMs + leaseMs).toISOString();
}

/**
 * Clear lease fields when leaving provisioning.
 * @returns {Record<string, null>}
 */
export function clearedProvisionLeaseFields() {
  return {
    provisioning_started_at: null,
    provisioning_lease_id: null,
    provisioning_lease_expires_at: null,
    provisioning_heartbeat_at: null,
    provisioning_lease_owner: null,
  };
}

/**
 * Build lease patch for a new claim / reclaim.
 * @param {{
 *   leaseId?: string;
 *   ownerId?: string;
 *   nowIso?: string;
 *   leaseMs?: number;
 *   plan?: string;
 *   gpu_label?: string;
 * }} [options]
 */
export function buildProvisionLeasePatch(options = {}) {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const leaseMs = options.leaseMs ?? PROVISION_LEASE_MS;
  const leaseId = options.leaseId ?? randomUUID();
  const ownerId = options.ownerId ?? createProvisionOwnerId();
  const expiresAt = computeLeaseExpiresAt(leaseMs, Date.parse(nowIso) || Date.now());
  /** @type {Record<string, unknown>} */
  const patch = {
    server_status: 'provisioning',
    provisioning_started_at: nowIso,
    provisioning_lease_id: leaseId,
    provisioning_lease_expires_at: expiresAt,
    provisioning_heartbeat_at: nowIso,
    provisioning_lease_owner: ownerId,
  };
  if (options.plan != null) patch.plan = options.plan;
  if (options.gpu_label != null) patch.gpu_label = options.gpu_label;
  return { patch, leaseId, ownerId, expiresAt, nowIso };
}

/**
 * Whether a provisioning claim lease is expired (safe to reclaim).
 *
 * @param {{
 *   provisioning_lease_expires_at?: string | null;
 *   provisioning_heartbeat_at?: string | null;
 *   provisioning_started_at?: string | null;
 *   provisioning_lease_id?: string | null;
 * } | null | undefined} subscription
 * @param {number} [nowMs]
 * @param {{ leaseMs?: number; maxIdleMs?: number; legacyStaleMs?: number }} [options]
 */
export function isProvisionLeaseExpired(subscription, nowMs = Date.now(), options = {}) {
  if (!subscription) return false;
  const maxIdleMs = options.maxIdleMs ?? PROVISION_MAX_IDLE_MS;
  const legacyStaleMs = options.legacyStaleMs ?? LEGACY_STALE_PROVISIONING_CLAIM_MS;

  const expiresRaw = subscription.provisioning_lease_expires_at;
  if (expiresRaw != null && expiresRaw !== '') {
    const expiresMs = new Date(String(expiresRaw)).getTime();
    if (Number.isFinite(expiresMs) && expiresMs > 0) {
      if (nowMs >= expiresMs) return true;
      // Dual check: heartbeat idle beyond max idle even if expires_at clock skew
      const hbRaw = subscription.provisioning_heartbeat_at ?? subscription.provisioning_started_at;
      if (hbRaw != null && hbRaw !== '') {
        const hbMs = new Date(String(hbRaw)).getTime();
        if (Number.isFinite(hbMs) && hbMs > 0 && nowMs - hbMs >= maxIdleMs) return true;
      }
      return false;
    }
  }

  // Legacy: no lease columns — fall back to started_at age
  const startedRaw = subscription.provisioning_started_at;
  if (startedRaw == null || startedRaw === '') return false;
  const startedMs = new Date(String(startedRaw)).getTime();
  if (!Number.isFinite(startedMs) || startedMs <= 0) return false;
  return nowMs - startedMs >= legacyStaleMs;
}

/**
 * @deprecated Prefer isProvisionLeaseExpired — kept for call-site compatibility.
 */
export function isStaleProvisioningClaim(subscription, nowMs = Date.now(), _staleMs) {
  return isProvisionLeaseExpired(subscription, nowMs);
}

/**
 * Remaining ms until lease expiry (0 if expired/missing).
 * @param {{ provisioning_lease_expires_at?: string | null } | null | undefined} subscription
 * @param {number} [nowMs]
 */
export function remainingLeaseMs(subscription, nowMs = Date.now()) {
  const raw = subscription?.provisioning_lease_expires_at;
  if (raw == null || raw === '') return 0;
  const expiresMs = new Date(String(raw)).getTime();
  if (!Number.isFinite(expiresMs)) return 0;
  return Math.max(0, expiresMs - nowMs);
}

/**
 * Atomic heartbeat: extend lease only if we still own leaseId.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} subscriptionId
 * @param {{
 *   leaseId: string;
 *   ownerId?: string;
 *   leaseMs?: number;
 *   nowIso?: string;
 *   requestId?: string | null;
 *   reason?: string;
 *   provider?: string | null;
 *   machineId?: string | null;
 *   gpuSessionId?: string | null;
 * }} options
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function heartbeatProvisionLease(supabaseAdmin, subscriptionId, options) {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const leaseMs = options.leaseMs ?? PROVISION_LEASE_MS;
  const expiresAt = computeLeaseExpiresAt(leaseMs, Date.parse(nowIso) || Date.now());

  /** @type {Record<string, unknown>} */
  const patch = {
    provisioning_heartbeat_at: nowIso,
    provisioning_lease_expires_at: expiresAt,
  };
  if (options.ownerId) patch.provisioning_lease_owner = options.ownerId;

  let query = supabaseAdmin
    .from('subscriptions')
    .update(patch)
    .eq('id', subscriptionId)
    .eq('server_status', 'provisioning')
    .eq('provisioning_lease_id', options.leaseId);

  const { data, error } = await query.select(LEASE_SELECT_COLS).maybeSingle();
  if (error) throw error;

  const remaining = remainingLeaseMs(data, Date.parse(nowIso) || Date.now());
  if (data) {
    incrProvisionLeaseMetric('leaseHeartbeat');
    logProvisionLeaseEvent(
      options.reason === 'auto' ? 'LEASE_HEARTBEAT' : 'LEASE_EXTENDED',
      {
        requestId: options.requestId,
        leaseId: options.leaseId,
        ownerId: options.ownerId ?? data.provisioning_lease_owner,
        subscriptionId,
        remainingLeaseMs: remaining,
        provider: options.provider ?? null,
        machineId: options.machineId ?? null,
        gpuSessionId: options.gpuSessionId ?? null,
        reason: options.reason ?? 'progress',
      },
      'Provision lease heartbeat',
    );
  }
  return data ?? null;
}

/**
 * In-process lease handle with auto-renew interval.
 */
export class ProvisionLeaseHandle {
  /**
   * @param {{
   *   supabaseAdmin: import('@supabase/supabase-js').SupabaseClient;
   *   subscriptionId: string;
   *   leaseId: string;
   *   ownerId: string;
   *   requestId?: string | null;
   *   provider?: string | null;
   *   createdAtMs?: number;
   * }} opts
   */
  constructor(opts) {
    this.supabaseAdmin = opts.supabaseAdmin;
    this.subscriptionId = opts.subscriptionId;
    this.leaseId = opts.leaseId;
    this.ownerId = opts.ownerId;
    this.requestId = opts.requestId ?? null;
    this.provider = opts.provider ?? null;
    this.machineId = null;
    this.gpuSessionId = null;
    this.createdAtMs = opts.createdAtMs ?? Date.now();
    this.lost = false;
    /** @type {ReturnType<typeof setInterval> | null} */
    this._timer = null;
    this._lastHeartbeatAt = Date.now();
  }

  /**
   * @param {string} [reason]
   * @returns {Promise<boolean>} true if still owned
   */
  async heartbeat(reason = 'progress') {
    if (this.lost) return false;
    try {
      const row = await heartbeatProvisionLease(this.supabaseAdmin, this.subscriptionId, {
        leaseId: this.leaseId,
        ownerId: this.ownerId,
        requestId: this.requestId,
        reason,
        provider: this.provider,
        machineId: this.machineId,
        gpuSessionId: this.gpuSessionId,
      });
      if (!row) {
        this.lost = true;
        this.stopAutoRenew();
        logProvisionLeaseEvent(
          'LEASE_EXPIRED',
          {
            requestId: this.requestId,
            leaseId: this.leaseId,
            ownerId: this.ownerId,
            subscriptionId: this.subscriptionId,
            remainingLeaseMs: 0,
            provider: this.provider,
            machineId: this.machineId,
            reason: 'heartbeat_lost_ownership',
          },
          'Provision lease lost during heartbeat',
        );
        incrProvisionLeaseMetric('leaseExpired');
        return false;
      }
      this._lastHeartbeatAt = Date.now();
      return true;
    } catch (error) {
      logProvisionLeaseEvent(
        'LEASE_HEARTBEAT',
        {
          requestId: this.requestId,
          leaseId: this.leaseId,
          subscriptionId: this.subscriptionId,
          err: { message: error instanceof Error ? error.message : String(error) },
        },
        'Provision lease heartbeat error',
      );
      return !this.lost;
    }
  }

  /** Progress callback for provider steps (wallet, marketplace, create_order, …). */
  async onProgress(step) {
    return this.heartbeat(typeof step === 'string' ? step : 'progress');
  }

  startAutoRenew(intervalMs = PROVISION_HEARTBEAT_MS) {
    if (this._timer) return;
    this._timer = setInterval(() => {
      void this.heartbeat('auto');
    }, intervalMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  stopAutoRenew() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Mark lease released (fields cleared by status transition separately).
   */
  release(reason = 'completed') {
    this.stopAutoRenew();
    const duration = Date.now() - this.createdAtMs;
    recordLeaseDurationMs(duration);
    incrProvisionLeaseMetric('leaseReleased');
    logProvisionLeaseEvent(
      'LEASE_RELEASED',
      {
        requestId: this.requestId,
        leaseId: this.leaseId,
        ownerId: this.ownerId,
        subscriptionId: this.subscriptionId,
        remainingLeaseMs: 0,
        provider: this.provider,
        machineId: this.machineId,
        gpuSessionId: this.gpuSessionId,
        reason,
        durationMs: duration,
      },
      'Provision lease released',
    );
  }
}

export { getProvisionLeaseMetrics, PROVISION_LEASE_MS, PROVISION_HEARTBEAT_MS, PROVISION_MAX_IDLE_MS };
