/**
 * Startup + in-process scheduler for Clore orphan-order reconciliation.
 */

import { randomUUID } from 'node:crypto';
import { CloreClient, getCloreProvisionInFlight } from './clore-client.js';
import {
  resolveCloreOrphanGraceMs,
  runCloreOrphanReconciliationPass,
} from './clore-orphan-reconcile.js';
import { logCloreOrphanEvent } from './clore-orphan-log.js';
import { logger } from '../../../logging/index.js';

/** @type {Map<string, { firstSeenAt: number; order: import('./clore-orphan-reconcile.js').normalizeCloreOrderSummary extends Function ? any : never; requestId: string }>} */
const pendingOrphans = new Map();

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const recheckTimers = new Map();

/** @type {ReturnType<typeof setInterval> | null} */
let intervalHandle = null;

/** @type {Promise<unknown> | null} */
let activePass = null;

function isEnabled() {
  const raw = String(process.env.CLORE_ORPHAN_RECONCILE ?? 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function resolveIntervalMs() {
  const raw = Number(process.env.CLORE_ORPHAN_RECONCILE_INTERVAL_MS ?? 5 * 60 * 1000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 5 * 60 * 1000;
}

/**
 * @param {string} orderId
 * @param {number} delayMs
 */
function scheduleRecheck(orderId, delayMs) {
  const existing = recheckTimers.get(orderId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    recheckTimers.delete(orderId);
    void kickCloreOrphanReconciliation({ reason: 'grace_recheck', orderId });
  }, Math.max(0, delayMs));
  if (typeof timer.unref === 'function') timer.unref();
  recheckTimers.set(orderId, timer);
}

/**
 * @param {{ reason?: string; orderId?: string }} [options]
 */
export async function kickCloreOrphanReconciliation(options = {}) {
  if (!isEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }
  // Avoid racing create_order / marketplace during an active provision.
  if (getCloreProvisionInFlight()) {
    return { skipped: true, reason: 'provision_in_flight' };
  }
  if (activePass) return activePass;

  activePass = (async () => {
    const requestId = randomUUID();
    try {
      const { getSupabaseAdmin } = await import('@/lib/supabase-admin');
      const cloreClient = new CloreClient();
      return await runCloreOrphanReconciliationPass({
        cloreClient,
        supabaseAdmin: getSupabaseAdmin(),
        graceMs: resolveCloreOrphanGraceMs(),
        pending: pendingOrphans,
        scheduleRecheck,
        requestId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logCloreOrphanEvent(
        'ORPHAN_RECONCILE_FAILED',
        {
          requestId,
          recoveryAction: 'reconcile_pass',
          reason: options.reason ?? 'kick',
          err: { message },
        },
        'Clore orphan reconciliation failed',
      );
      return { skipped: true, reason: message };
    } finally {
      activePass = null;
    }
  })();

  return activePass;
}

/**
 * Called from Next.js instrumentation on Node server boot.
 */
export function startCloreOrphanReconciliation() {
  if (!isEnabled()) {
    logger('app').info(
      { operation: 'clore.orphan', event: 'ORPHAN_RECONCILE_DISABLED' },
      'Clore orphan reconciliation disabled',
    );
    return;
  }

  // Initial pass shortly after boot (let env / supabase settle)
  const bootDelayMs = Number(process.env.CLORE_ORPHAN_BOOT_DELAY_MS ?? 15_000);
  const bootTimer = setTimeout(() => {
    void kickCloreOrphanReconciliation({ reason: 'startup' });
  }, Number.isFinite(bootDelayMs) && bootDelayMs >= 0 ? bootDelayMs : 15_000);
  if (typeof bootTimer.unref === 'function') bootTimer.unref();

  if (intervalHandle) return;
  const intervalMs = resolveIntervalMs();
  if (intervalMs <= 0) return;

  intervalHandle = setInterval(() => {
    void kickCloreOrphanReconciliation({ reason: 'interval' });
  }, intervalMs);
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();

  logger('app').info(
    {
      operation: 'clore.orphan',
      event: 'ORPHAN_RECONCILE_STARTED',
      graceMs: resolveCloreOrphanGraceMs(),
      intervalMs,
      bootDelayMs,
    },
    'Clore orphan reconciliation scheduled',
  );
}

/** Test helper */
export function resetCloreOrphanRunnerForTests() {
  for (const timer of recheckTimers.values()) clearTimeout(timer);
  recheckTimers.clear();
  pendingOrphans.clear();
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  activePass = null;
}
