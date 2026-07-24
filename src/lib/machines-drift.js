/**
 * SCB 2.1 Phase 1 — Detect / Repair separation for subscription ↔ machine drift.
 * Detect preserves existing syncSubscriptionWithMachineState business rules.
 * Read paths enqueue repairs without awaiting destroy pipeline.
 */

import { profStart, profEnd } from '@/lib/prof';
import { createCorrelationId } from '@/lib/scb-correlation';
import { isMachineOperationsTableUnavailable } from '@/lib/infrastructure/machine-operation-core';
import {
  buildDetectResult,
} from '@/lib/machines-drift-core';
import {
  getActiveMachineForUser,
  destroyUserMachine,
  resolveLiveMachineStatus,
  updateSubscriptionServerStatus,
  markMachineDestroyedLocal,
  fetchActiveSubscription,
} from '@/lib/machines';
import {
  shouldRepairBootingSubscriptionDrift,
  shouldResetIdleProvisioningSubscription,
  shouldSkipDeadInstanceDestroyDuringBoot,
  shouldDestroyStaleBootMachine,
  isRecentBootMachine,
  STALE_BOOT_MS,
} from '@/lib/machines-provisioning-sync';
import { snapshotToMachineRecord } from '@/lib/gpu/machine-lifecycle';
import { persistDestroyCompleted, persistDriftRepair } from '@/lib/gpu/machine-lifecycle-persist';
import { shouldKeepBillingSessionOpenOnRuntimeDead } from '@/lib/gpu/billing-session-p0b.js';
import { enqueueRuntimeAutoReplace } from '@/lib/infrastructure/enqueue-runtime-auto-replace.js';
import { RUNTIME_REPLACE_UX_MESSAGE } from '@/lib/gpu/runtime-auto-replace-core.js';

export { isScb21ReadPathDetectOnly, detectProvisionFailureDrift, toSyncShape } from '@/lib/machines-drift-core';

/** @typedef {'update_subscription' | 'mark_destroyed_local' | 'destroy_user_machine' | 'destroy_and_subscription_offline'} DriftRepairKind */

/**
 * @typedef {Object} DriftRepairSpec
 * @property {DriftRepairKind} kind
 * @property {string} [subscriptionId]
 * @property {'online' | 'offline' | 'provisioning'} [serverStatus]
 * @property {Record<string, unknown>} [machine]
 * @property {{ skipBackup?: boolean; interrupted?: boolean; skipBilling?: boolean; skipMetrics?: boolean; reason?: string }} [destroyOptions]
 */

/**
 * @typedef {Object} DriftDetectResult
 * @property {boolean} changed
 * @property {Record<string, unknown>|null} machine
 * @property {Record<string, unknown>|null} subscription
 * @property {string|null} action
 * @property {DriftRepairSpec|null} repair
 */

/**
 * Detect subscription/machine drift — same branching as legacy sync, no repair writes.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {import('@/lib/gpu/gpu-service').GPUService | null | undefined} gpuService
 * @param {string} userId
 * @returns {Promise<DriftDetectResult>}
 */
export async function detectSubscriptionMachineDrift(supabaseAdmin, gpuService, userId) {
  const __prof = profStart('detectSubscriptionMachineDrift');
  try {
    const machine = await getActiveMachineForUser(supabaseAdmin, userId);
    const subscription = await fetchActiveSubscription(supabaseAdmin, userId);

    if (!subscription) {
      return buildDetectResult(false, machine, null, null, null);
    }

    if (machine && subscription.server_status === 'offline') {
      const machineSubId =
        machine.subscription_id != null ? String(machine.subscription_id) : null;
      // Newer offline subscription (hour top-up) must not destroy a session owned by another sub.
      if (machineSubId && machineSubId !== String(subscription.id)) {
        return buildDetectResult(false, machine, subscription, null, null);
      }
      if (shouldRepairBootingSubscriptionDrift(machine, subscription.server_status)) {
        return buildDetectResult(
          true,
          machine,
          { ...subscription, server_status: 'provisioning' },
          'repaired_booting_subscription',
          {
            kind: 'update_subscription',
            subscriptionId: String(subscription.id),
            serverStatus: 'provisioning',
          },
        );
      }

      if (gpuService && isRecentBootMachine(machine)) {
        const liveHint = await resolveLiveMachineStatus(gpuService, machine);
        if (liveHint.status !== 'error') {
          return buildDetectResult(
            true,
            machine,
            { ...subscription, server_status: 'provisioning' },
            'repaired_offline_subscription',
            {
              kind: 'update_subscription',
              subscriptionId: String(subscription.id),
              serverStatus: 'provisioning',
            },
          );
        }
      }

      if (!gpuService) {
        return buildDetectResult(
          true,
          null,
          subscription,
          'destroyed_leaked_machine_local',
          { kind: 'mark_destroyed_local', machine },
        );
      }

      return buildDetectResult(
        true,
        null,
        { ...subscription, server_status: 'offline' },
        'destroyed_leaked_machine',
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

    if (!machine) {
      if (subscription.server_status === 'online') {
        return buildDetectResult(
          true,
          null,
          { ...subscription, server_status: 'offline' },
          'reset_orphan_online',
          {
            kind: 'update_subscription',
            subscriptionId: String(subscription.id),
            serverStatus: 'offline',
          },
        );
      }

      if (shouldResetIdleProvisioningSubscription(machine, subscription.server_status)) {
        return buildDetectResult(
          true,
          null,
          { ...subscription, server_status: 'offline' },
          'reset_idle_provisioning',
          {
            kind: 'update_subscription',
            subscriptionId: String(subscription.id),
            serverStatus: 'offline',
          },
        );
      }

      return buildDetectResult(false, null, subscription, null, null);
    }

    if (machine && !machine.instance_id) {
      return buildDetectResult(
        true,
        null,
        { ...subscription, server_status: 'offline' },
        'reset_invalid_machine_row',
        {
          kind: 'mark_destroyed_local',
          machine,
          subscriptionId:
            subscription.server_status !== 'offline' ? String(subscription.id) : undefined,
          serverStatus: subscription.server_status !== 'offline' ? 'offline' : undefined,
        },
      );
    }

    if (
      gpuService &&
      machine &&
      (subscription.server_status === 'provisioning' || subscription.server_status === 'online') &&
      String(machine.status ?? '') !== 'running'
    ) {
      const createdAt = machine.created_at ? new Date(String(machine.created_at)).getTime() : 0;
      const ageMs = createdAt > 0 ? Date.now() - createdAt : STALE_BOOT_MS + 1;

      if (ageMs > STALE_BOOT_MS) {
        const liveStatus = await resolveLiveMachineStatus(gpuService, machine);
        if (shouldDestroyStaleBootMachine(liveStatus)) {
          return buildDetectResult(
            true,
            null,
            { ...subscription, server_status: 'offline' },
            'reset_stale_boot',
            {
              kind: 'destroy_and_subscription_offline',
              subscriptionId: String(subscription.id),
              destroyOptions: {
                skipBackup: true,
                interrupted: true,
                skipMetrics: true,
                reason: 'user_stop',
              },
            },
          );
        }
      }
    }

    if (gpuService && machine.instance_id) {
      try {
        await gpuService.getInstanceStatus(String(machine.instance_id));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not found|404|does not exist|invalid instance/i.test(message)) {
          if (shouldSkipDeadInstanceDestroyDuringBoot(machine, message)) {
            return buildDetectResult(false, machine, subscription, null, null);
          }

          // P0-B / P1: open billable session → keep OPEN + auto-replace (never settle).
          let openSession = null;
          if (machine.gpu_session_id) {
            const { data: sess } = await supabaseAdmin
              .from('gpu_sessions')
              .select('id, status, started_at, ended_at, close_requested_at, plan, template')
              .eq('id', String(machine.gpu_session_id))
              .maybeSingle();
            openSession = sess;
          }
          if (shouldKeepBillingSessionOpenOnRuntimeDead(openSession)) {
            const now = new Date().toISOString();
            await supabaseAdmin
              .from('machines')
              .update({
                status: 'error',
                projection_message: RUNTIME_REPLACE_UX_MESSAGE,
                updated_at: now,
              })
              .eq('id', machine.id);
            try {
              await enqueueRuntimeAutoReplace(supabaseAdmin, {
                userId,
                sessionId: String(openSession.id),
                oldMachineId: String(machine.id),
                subscriptionId: String(subscription.id),
                planKey: String(
                  subscription.plan_key || subscription.plan || openSession.plan || 'pro',
                ).toLowerCase(),
                planName: String(subscription.plan || openSession.plan || 'Pro'),
                gpuLine: String(
                  machine.gpu_line || machine.gpu_type || subscription.gpu_line || 'rtx_4090',
                ),
                envName: String(subscription.env_name || openSession.template || 'ComfyUI'),
                billingStartedAt: String(
                  machine.billing_started_at || openSession.started_at,
                ),
                provider: machine.provider != null ? String(machine.provider) : null,
                session: openSession,
              });
            } catch (enqueueErr) {
              console.warn(
                '[detectSubscriptionMachineDrift] enqueue runtime_auto_replace failed:',
                enqueueErr instanceof Error ? enqueueErr.message : enqueueErr,
              );
            }
            return buildDetectResult(
              true,
              { ...machine, status: 'error', projection_message: RUNTIME_REPLACE_UX_MESSAGE },
              subscription,
              'runtime_dead_session_kept_open',
              null,
            );
          }

          return buildDetectResult(
            true,
            null,
            { ...subscription, server_status: 'offline' },
            'destroyed_dead_instance',
            {
              kind: 'destroy_and_subscription_offline',
              subscriptionId: String(subscription.id),
              destroyOptions: {
                skipBackup: true,
                interrupted: true,
                skipMetrics: true,
                reason: 'user_stop',
              },
            },
          );
        }
      }
    }

    return buildDetectResult(false, machine, subscription, null, null);
  } finally {
    profEnd(__prof);
  }
}

/**
 * Map drift detect action to lifecycle SM repairAction payload.
 *
 * @param {string|null|undefined} action
 * @returns {'promote_online'|'reset_idle'|'mark_destroyed'|'destroy_machine'|null}
 */
function repairActionFromDriftAction(action) {
  if (!action) return null;
  if (action === 'repaired_provisioning_to_online') return 'promote_online';
  if (action === 'reset_orphan_online') return 'reset_idle';
  if (
    action === 'reset_stale_provisioning_boot' ||
    action === 'destroyed_leaked_provisioning_machine' ||
    action === 'reset_invalid_machine_row'
  ) {
    return 'mark_destroyed';
  }
  if (action === 'destroyed_leaked_machine') return 'destroy_machine';
  return null;
}

/**
 * Persist lifecycle SM after worker drift repair (non-fatal on invalid transition).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {DriftDetectResult} detectResult
 */
async function persistDriftRepairLifecycle(supabaseAdmin, userId, detectResult) {
  const subscription = detectResult.subscription;
  if (!subscription?.id) return;

  const repairAction = repairActionFromDriftAction(detectResult.action);
  if (!repairAction) return;

  const machine = detectResult.machine ?? detectResult.repair?.machine ?? null;
  const record = snapshotToMachineRecord(subscription, machine, userId);
  if (!record) return;

  const lifecycleCtx = {
    userId,
    subscriptionId: String(subscription.id),
    source: 'drift_repair_worker',
  };

  try {
    if (repairAction === 'promote_online' || repairAction === 'reset_idle') {
      await persistDriftRepair(
        supabaseAdmin,
        String(subscription.id),
        record,
        lifecycleCtx,
        repairAction,
      );
      return;
    }

    await persistDestroyCompleted(
      supabaseAdmin,
      String(subscription.id),
      record,
      lifecycleCtx,
    );
  } catch (error) {
    console.warn(
      '[drift-repair] lifecycle SM persist failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Execute a drift repair (same side effects as legacy inline sync).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {import('@/lib/gpu/gpu-service').GPUService | null | undefined} gpuService
 * @param {string} userId
 * @param {DriftDetectResult} detectResult
 * @returns {Promise<DriftDetectResult>}
 */
export async function executeSubscriptionMachineDriftRepair(
  supabaseAdmin,
  gpuService,
  userId,
  detectResult,
) {
  const repair = detectResult.repair;
  if (!repair) {
    return detectResult;
  }

  const __prof = profStart(`executeDriftRepair:${detectResult.action ?? 'none'}`);
  try {
    switch (repair.kind) {
      case 'update_subscription':
        if (repair.subscriptionId && repair.serverStatus) {
          await updateSubscriptionServerStatus(
            supabaseAdmin,
            repair.subscriptionId,
            repair.serverStatus,
          );
        }
        break;

      case 'mark_destroyed_local':
        if (repair.machine) {
          await markMachineDestroyedLocal(supabaseAdmin, repair.machine);
        }
        if (repair.subscriptionId && repair.serverStatus) {
          await updateSubscriptionServerStatus(
            supabaseAdmin,
            repair.subscriptionId,
            repair.serverStatus,
          );
        }
        break;

      case 'destroy_user_machine':
        if (gpuService && repair.destroyOptions) {
          await destroyUserMachine(supabaseAdmin, gpuService, userId, repair.destroyOptions);
        }
        break;

      case 'destroy_and_subscription_offline':
        if (gpuService && repair.destroyOptions) {
          await destroyUserMachine(supabaseAdmin, gpuService, userId, repair.destroyOptions);
        }
        if (repair.subscriptionId) {
          await updateSubscriptionServerStatus(supabaseAdmin, repair.subscriptionId, 'offline');
        }
        break;

      default:
        break;
    }

    await persistDriftRepairLifecycle(supabaseAdmin, userId, detectResult);

    return detectResult;
  } finally {
    profEnd(__prof);
  }
}

/**
 * Phase 2 — enqueue drift repair into machine_operations (no inline execute).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {import('@/lib/gpu/gpu-service').GPUService | null | undefined} _gpuService
 * @param {string} userId
 * @param {DriftDetectResult|null|undefined} detectResult
 * @param {{ correlationId?: string; source?: string }} [options]
 * @returns {Promise<{ operation: Record<string, unknown>; created: boolean }|null>}
 */
export async function enqueueSubscriptionMachineDriftRepair(
  supabaseAdmin,
  _gpuService,
  userId,
  detectResult,
  options = {},
) {
  if (!detectResult?.repair) return null;

  const { scheduleDriftRepair } = await import('@/lib/infrastructure/machine-operation-scheduler');
  return scheduleDriftRepair(supabaseAdmin, userId, detectResult, options);
}

/**
 * Read-path helper: detect then enqueue (never awaits destroy pipeline).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {import('@/lib/gpu/gpu-service').GPUService | null | undefined} gpuService
 * @param {string} userId
 * @param {{ correlationId?: string; source?: string }} [options]
 * @returns {Promise<DriftDetectResult>}
 */
export async function runReadPathDriftDetectAndEnqueue(supabaseAdmin, gpuService, userId, options = {}) {
  const correlationId = createCorrelationId(options.correlationId);
  const detectResult = await detectSubscriptionMachineDrift(supabaseAdmin, gpuService, userId);
  try {
    await enqueueSubscriptionMachineDriftRepair(supabaseAdmin, gpuService, userId, detectResult, {
      correlationId,
      source: options.source ?? 'read_path_drift',
    });
  } catch (err) {
    if (isMachineOperationsTableUnavailable(err)) {
      console.warn(
        '[machines-drift] machine_operations unavailable — detect-only continues without enqueue.',
        err.message,
      );
    } else {
      throw err;
    }
  }
  return detectResult;
}
