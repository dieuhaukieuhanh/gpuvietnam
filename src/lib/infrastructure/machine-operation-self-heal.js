/**
 * SCB 2.1 Phase 2.5 — Queue self-healing before worker leases new jobs.
 */

import { MACHINE_OPERATION_STATE } from './machine-operation-core.js';
import {
  LEASE_DURATION_MS,
  PENDING_STALE_MS,
  RUNNING_ORPHAN_MS,
} from './machine-operation-policies.js';
import { logMachineOperation } from './machine-operation-observability.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ releasedLeases: number; promotedRetries: number; recoveredRunning: number; cleanedOrphans: number }>}
 */
export async function runQueueSelfHealing(supabaseAdmin, options = {}) {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const runningCutoff = new Date(now.getTime() - RUNNING_ORPHAN_MS).toISOString();
  const pendingStaleCutoff = new Date(now.getTime() - PENDING_STALE_MS).toISOString();

  const { data: releasedLeasesRows, error: releasedError } = await supabaseAdmin
    .from('machine_operations')
    .update({
      state: MACHINE_OPERATION_STATE.PENDING,
      lease_until: null,
      retry_reason: 'stale_lease_recovered',
    })
    .eq('state', MACHINE_OPERATION_STATE.LEASED)
    .lt('lease_until', nowIso)
    .select('id');
  if (releasedError) throw releasedError;

  const { data: promotedRows, error: promotedError } = await supabaseAdmin
    .from('machine_operations')
    .update({
      state: MACHINE_OPERATION_STATE.PENDING,
      retry_reason: 'retry_window_open',
    })
    .eq('state', MACHINE_OPERATION_STATE.RETRY_SCHEDULED)
    .lte('next_retry_at', nowIso)
    .select('id');
  if (promotedError) throw promotedError;

  const { data: recoveredRunningRows, error: runningError } = await supabaseAdmin
    .from('machine_operations')
    .update({
      state: MACHINE_OPERATION_STATE.PENDING,
      lease_until: null,
      retry_reason: 'stale_running_recovered',
    })
    .eq('state', MACHINE_OPERATION_STATE.RUNNING)
    .lt('started_at', runningCutoff)
    .select('id');
  if (runningError) throw runningError;

  const { data: orphanRows, error: orphanError } = await supabaseAdmin
    .from('machine_operations')
    .update({
      state: MACHINE_OPERATION_STATE.PENDING,
      lease_until: null,
      retry_reason: 'orphan_lease_cleaned',
    })
    .eq('state', MACHINE_OPERATION_STATE.RUNNING)
    .is('lease_until', null)
    .select('id');
  if (orphanError) throw orphanError;

  const { data: stalePendingRows, error: stalePendingError } = await supabaseAdmin
    .from('machine_operations')
    .update({
      retry_reason: 'stale_pending_recovered',
      priority: 65,
    })
    .eq('state', MACHINE_OPERATION_STATE.PENDING)
    .lt('created_at', pendingStaleCutoff)
    .select('id');
  if (stalePendingError) throw stalePendingError;

  const summary = {
    releasedLeases: releasedLeasesRows?.length ?? 0,
    promotedRetries: promotedRows?.length ?? 0,
    recoveredRunning: recoveredRunningRows?.length ?? 0,
    cleanedOrphans: orphanRows?.length ?? 0,
    rearmedStalePending: stalePendingRows?.length ?? 0,
  };

  if (
    summary.releasedLeases +
      summary.promotedRetries +
      summary.recoveredRunning +
      summary.cleanedOrphans +
      summary.rearmedStalePending >
    0
  ) {
    logMachineOperation(
      'machine-op-self-heal',
      { correlationId: null, operationId: null, durationMs: null, extra: summary },
      'queue self-healing applied',
    );
  }

  return summary;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ now?: Date; leaseMs?: number }} [options]
 * @returns {Promise<number>}
 */
export async function releaseExpiredLeases(supabaseAdmin, options = {}) {
  const nowIso = (options.now ?? new Date()).toISOString();
  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .update({
      state: MACHINE_OPERATION_STATE.PENDING,
      lease_until: null,
      retry_reason: 'lease_expired',
    })
    .eq('state', MACHINE_OPERATION_STATE.LEASED)
    .lt('lease_until', nowIso)
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ now?: Date }} [options]
 * @returns {Promise<number>}
 */
export async function promoteReadyRetries(supabaseAdmin, options = {}) {
  const nowIso = (options.now ?? new Date()).toISOString();
  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .update({
      state: MACHINE_OPERATION_STATE.PENDING,
      retry_reason: 'retry_promoted',
    })
    .eq('state', MACHINE_OPERATION_STATE.RETRY_SCHEDULED)
    .lte('next_retry_at', nowIso)
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

export { LEASE_DURATION_MS };
