/**
 * SCB 2.1 AF v2 — Verification Pipeline (off HTTP read path).
 * Provider verify → update projection → detect drift → enqueue repair.
 */

import { openBillableSession } from '@/lib/gpu';
import { createCorrelationId } from '@/lib/scb-correlation';
import { isProjectionTrafficReady } from '@/lib/scb-read-path';
import {
  detectProvisionFailureDrift,
  detectSubscriptionMachineDrift,
  enqueueSubscriptionMachineDriftRepair,
} from '@/lib/machines-drift';
import {
  fetchActiveSubscription,
  getActiveMachineForUser,
  resolveLiveMachineStatus,
  syncMachineFromLiveStatus,
  updateMachineRecord,
  updateSubscriptionServerStatus,
} from '@/lib/machines';
import { logProjectionVerifyTrace } from './projection-verify-trace.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {import('@/lib/gpu/gpu-service').GPUService} gpuService
 * @param {string} userId
 * @param {{ correlationId?: string; source?: string; machineId?: string|null; pvTrace?: import('./projection-verify-trace.js').ProjectionVerifyTraceContext|null }} [options]
 */
export async function runProjectionVerificationPipeline(
  supabaseAdmin,
  gpuService,
  userId,
  options = {},
) {
  const correlationId = createCorrelationId(options.correlationId);
  const source = options.source ?? 'verification_pipeline';
  const pvTrace = options.pvTrace ?? null;

  logProjectionVerifyTrace('runProjectionVerificationPipeline() ENTER', pvTrace, {
    source,
    user_id: userId,
    machine_id: options.machineId ?? null,
  });

  let machine = await getActiveMachineForUser(supabaseAdmin, userId);
  if (options.machineId && machine && String(machine.id) !== String(options.machineId)) {
    machine = null;
  }

  const subscription = await fetchActiveSubscription(supabaseAdmin, userId);
  /** @type {Record<string, unknown>|null} */
  let liveStatus = null;

  if (machine?.instance_id) {
    liveStatus = await resolveLiveMachineStatus(gpuService, machine, {
      onPvTrace: pvTrace
        ? (checkpoint, payload) => logProjectionVerifyTrace(checkpoint, pvTrace, payload)
        : undefined,
    });

    if (liveStatus.status === 'error') {
      const provisionDrift = detectProvisionFailureDrift(machine, liveStatus);
      if (provisionDrift?.repair) {
        await enqueueSubscriptionMachineDriftRepair(
          supabaseAdmin,
          gpuService,
          userId,
          provisionDrift,
          { correlationId, source: `provision_failure:${source}` },
        );
      }
      if (machine?.id) {
        await updateMachineRecord(supabaseAdmin, String(machine.id), {
          projection_verified_at: new Date().toISOString(),
          projection_message:
            typeof liveStatus.message === 'string' ? liveStatus.message : null,
        });
      }
    } else {
      logProjectionVerifyTrace('syncMachineFromLiveStatus() input/output', pvTrace, {
        phase: 'input',
        machine_id: machine.id != null ? String(machine.id) : null,
        machine_status: machine.status != null ? String(machine.status) : null,
        machine_port: machine.port ?? null,
        live_status: liveStatus.status ?? null,
        live_health_ok: liveStatus.healthOk ?? null,
        live_ip: liveStatus.ip ?? null,
        live_port: liveStatus.port ?? null,
      });

      const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, machine, liveStatus);

      logProjectionVerifyTrace('syncMachineFromLiveStatus() input/output', pvTrace, {
        phase: 'output',
        machine_id: syncedMachine?.id != null ? String(syncedMachine.id) : null,
        status: syncedMachine?.status != null ? String(syncedMachine.status) : null,
        port: syncedMachine?.port ?? null,
        ip_address: syncedMachine?.ip_address ?? null,
      });

      const projectionMessage =
        typeof liveStatus.message === 'string' ? liveStatus.message : null;
      const projectionUpdated = syncedMachine?.id
        ? await updateMachineRecord(supabaseAdmin, String(syncedMachine.id), {
            projection_verified_at: new Date().toISOString(),
            projection_message: projectionMessage,
          })
        : null;

      const machineRow = projectionUpdated ?? syncedMachine ?? machine;
      machine = machineRow;

      logProjectionVerifyTrace('projection_verified_at after update', pvTrace, {
        machine_id: machineRow?.id != null ? String(machineRow.id) : null,
        projection_verified_at: machineRow?.projection_verified_at ?? null,
        projection_message: machineRow?.projection_message ?? null,
      });

      logProjectionVerifyTrace('UPDATE machines affected rows', pvTrace, {
        affected_rows: machineRow ? 1 : 0,
        machine_id: machineRow?.id != null ? String(machineRow.id) : null,
      });

      if (
        liveStatus.status === 'running' &&
        liveStatus.healthOk === true &&
        isProjectionTrafficReady(machineRow)
      ) {
        if (machine.subscription_id) {
          await updateSubscriptionServerStatus(
            supabaseAdmin,
            String(machine.subscription_id),
            'online',
          );
        }

        if (liveStatus.instanceId) {
          try {
            await openBillableSession(
              supabaseAdmin,
              userId,
              liveStatus.instanceId,
              gpuService,
            );
          } catch (billingError) {
            console.warn(
              '[projection-verification] openBillableSession failed (non-fatal):',
              billingError,
            );
          }
        }
      }
    }
  }

  const detectResult = await detectSubscriptionMachineDrift(supabaseAdmin, gpuService, userId);
  await enqueueSubscriptionMachineDriftRepair(supabaseAdmin, gpuService, userId, detectResult, {
    correlationId,
    source: `verify_detect:${source}`,
  });

  return {
    correlationId,
    liveStatus,
    detectResult,
    subscription,
    machine,
  };
}
