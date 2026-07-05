/**

 * SCB 2.1 AF v2 — Projection-only drift detect (no Provider I/O on HTTP read path).

 */



import { createCorrelationId } from '@/lib/scb-correlation';

import { scheduleProjectionVerification } from '@/lib/infrastructure/machine-operation-scheduler';

import { isMachineOperationsTableUnavailable } from '@/lib/infrastructure/machine-operation-core';

import { enqueueSubscriptionMachineDriftRepair } from '@/lib/machines-drift';

import { buildDetectResult } from '@/lib/machines-drift-core';

import { detectDriftRepair } from '@/lib/gpu/machine-lifecycle';

import {

  fetchActiveSubscription,

  getActiveMachineForUser,

} from '@/lib/machines';

import { profStart, profEnd } from '@/lib/prof';

import { isProjectionVerificationStale } from '@/lib/scb-read-path';



/** @typedef {import('./machines-drift.js').DriftDetectResult} DriftDetectResult */

/**
 * @typedef {import('@/lib/gpu/machine-lifecycle.js').ReturnType<typeof detectDriftRepair>} DriftRepairHint
 */

/**
 * @param {Record<string, unknown>} subscription
 * @param {Record<string, unknown>|null} machine
 * @param {NonNullable<DriftRepairHint>} drift
 * @returns {DriftDetectResult}
 */
function mapDriftRepairToDetectResult(subscription, machine, drift) {
  const { repairAction, repairKind, reason } = drift;

  if (repairAction === 'mark_destroyed' && reason === 'reset_stale_provisioning_boot') {
    return buildDetectResult(
      true,
      null,
      { ...subscription, server_status: 'offline' },
      reason,
      {
        kind: 'mark_destroyed_local',
        machine,
        subscriptionId: String(subscription.id),
        serverStatus: 'offline',
      },
    );
  }

  if (repairAction === 'promote_provisioning' || reason === 'repaired_booting_subscription') {
    return buildDetectResult(
      true,
      machine,
      { ...subscription, server_status: 'provisioning' },
      reason,
      {
        kind: 'update_subscription',
        subscriptionId: String(subscription.id),
        serverStatus: 'provisioning',
      },
    );
  }

  if (repairAction === 'destroy_machine') {
    return buildDetectResult(
      true,
      null,
      { ...subscription, server_status: 'offline' },
      reason,
      {
        kind: 'destroy_user_machine',
        destroyOptions: {
          skipBackup: true,
          interrupted: true,
          skipMetrics: true,
          reason: 'user_stop',
        },
      },
    );
  }

  if (repairAction === 'promote_online') {
    return buildDetectResult(
      true,
      machine,
      { ...subscription, server_status: 'online' },
      reason,
      {
        kind: 'update_subscription',
        subscriptionId: String(subscription.id),
        serverStatus: 'online',
      },
    );
  }

  if (repairAction === 'mark_destroyed' && reason === 'destroyed_leaked_provisioning_machine') {
    return buildDetectResult(
      true,
      null,
      { ...subscription, server_status: 'offline' },
      reason,
      {
        kind: 'mark_destroyed_local',
        machine,
        subscriptionId: String(subscription.id),
        serverStatus: 'offline',
      },
    );
  }

  if (repairAction === 'reset_idle') {
    return buildDetectResult(
      false,
      machine,
      subscription,
      reason,
      {
        kind: 'update_subscription',
        subscriptionId: String(subscription.id),
        serverStatus: 'offline',
      },
    );
  }

  if (repairAction === 'mark_destroyed' && reason === 'reset_invalid_machine_row') {
    return buildDetectResult(
      true,
      null,
      { ...subscription, server_status: 'offline' },
      reason,
      {
        kind: 'mark_destroyed_local',
        machine,
        subscriptionId:
          subscription.server_status !== 'offline' ? String(subscription.id) : undefined,
        serverStatus: subscription.server_status !== 'offline' ? 'offline' : undefined,
      },
    );
  }

  return buildDetectResult(false, machine, subscription, null, null);
}



/**

 * @typedef {Object} ProjectionPrefetch

 * @property {Record<string, unknown>|null} [machine]

 * @property {Record<string, unknown>|null} [subscription]

 */



/**

 * Detect drift using DB projection only — no resolveLiveMachineStatus / getInstanceStatus.

 *

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} userId

 * @param {ProjectionPrefetch} [prefetch]

 * @returns {Promise<DriftDetectResult>}

 */

export async function detectSubscriptionMachineDriftProjectionOnly(supabaseAdmin, userId, prefetch = {}) {

  const machine =

    'machine' in prefetch

      ? prefetch.machine

      : await getActiveMachineForUser(supabaseAdmin, userId);

  const subscription =

    'subscription' in prefetch

      ? prefetch.subscription

      : await fetchActiveSubscription(supabaseAdmin, userId);



  if (!subscription) {
    return buildDetectResult(false, machine, null, null, null);
  }

  const drift = detectDriftRepair(subscription, machine);
  if (!drift) {
    return buildDetectResult(false, machine, subscription, null, null);
  }

  return mapDriftRepairToDetectResult(subscription, machine, drift);
}



/**

 * @param {Record<string, unknown>|null|undefined} subscription

 * @returns {Record<string, unknown>|null|undefined}

 */

export function subscriptionPrefetchFromDashboardRow(subscription) {

  if (!subscription) return null;

  if (!['active', 'provisioning'].includes(String(subscription.status ?? ''))) {

    return undefined;

  }

  return {

    id: subscription.id,

    server_status: subscription.server_status,

    status: subscription.status,

    created_at: subscription.created_at,

  };

}



/**

 * Read path AF v2: projection detect + enqueue repair + schedule async verification.

 *

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} userId

 * @param {{

 *   correlationId?: string;

 *   source?: string;

 *   machine?: Record<string, unknown>|null;

 *   subscription?: Record<string, unknown>|null;

 * }} [options]

 * @returns {Promise<DriftDetectResult>}

 */

export async function runReadPathProjectionFirst(supabaseAdmin, userId, options = {}) {

  const correlationId = createCorrelationId(options.correlationId);

  /** @type {ProjectionPrefetch} */

  const prefetch = {};



  const loadMachineSpan = profStart('Load Machine');

  const machineRow =

    'machine' in options

      ? options.machine

      : await getActiveMachineForUser(supabaseAdmin, userId);

  prefetch.machine = machineRow;

  profEnd(loadMachineSpan);



  const loadSubscriptionSpan = profStart('Load Subscription');

  if ('subscription' in options) {

    prefetch.subscription = options.subscription;

  } else {

    prefetch.subscription = await fetchActiveSubscription(supabaseAdmin, userId);

  }

  profEnd(loadSubscriptionSpan);



  const detectSpan = profStart('Detect Projection');

  const detectResult = await detectSubscriptionMachineDriftProjectionOnly(

    supabaseAdmin,

    userId,

    prefetch,

  );

  profEnd(detectSpan);

  const driftEnqueueSpan = profStart('Drift Queue Enqueue');

  try {

    await enqueueSubscriptionMachineDriftRepair(

      supabaseAdmin,

      null,

      userId,

      detectResult,

      {

        correlationId,

        source: options.source ?? 'read_path_projection',

      },

    );

  } catch (err) {

    if (isMachineOperationsTableUnavailable(err)) {

      console.warn(

        '[machines-drift-projection] machine_operations unavailable — projection read continues.',

        err.message,

      );

    } else {

      profEnd(driftEnqueueSpan);

      throw err;

    }

  }

  profEnd(driftEnqueueSpan);



  const machineForVerify = machineRow ?? detectResult.machine ?? null;



  if (machineForVerify && isProjectionVerificationStale(machineForVerify)) {

    const verifyEnqueueSpan = profStart('Projection Verify Queue Enqueue');

    try {

      await scheduleProjectionVerification(supabaseAdmin, userId, {

        correlationId,

        source: options.source ?? 'read_path_projection',

        machineId: machineForVerify.id ? String(machineForVerify.id) : null,

        machine: machineForVerify,

      });

    } catch (err) {

      if (isMachineOperationsTableUnavailable(err)) {

        console.warn(

          '[machines-drift-projection] verification enqueue skipped — table unavailable.',

          err.message,

        );

      } else {

        profEnd(verifyEnqueueSpan);

        throw err;

      }

    }

    profEnd(verifyEnqueueSpan);

  }



  const mappingSpan = profStart('Projection Mapping');

  profEnd(mappingSpan);



  const returnSpan = profStart('Return');

  profEnd(returnSpan);



  return detectResult;

}


