import {
  formatGpuUserMessage,
  getGpuService,
  provisionGpuInstance,
  createProvisioningPendingSession,
  snapshotToMachineRecord,
  persistProviderRunning,
  persistMachineSubscriptionStatus,
  MACHINE_COMMAND,
  runMachineTransition,
} from '@/lib/gpu';
import { getGpuLabel } from '@/lib/gpu-pricing';
import {
  insertMachineRecord,
  mapGpuInstanceToMachineRow,
  resolveLiveMachineStatus,
  rollbackProvisionAfterRentFailure,
  syncMachineFromLiveStatus,
} from '@/lib/machines';

/**
 * Background Vast rent + machine row after start-machine returned opening view to client.
 */
export async function completeUserStartProvision(supabaseAdmin, params) {
  const {
    userId,
    subscriptionId,
    subscription,
    selected,
    planKey,
    planName,
    gpuLine,
    envName,
    workstationContainerEnv,
    lifecycleCtx,
    correlationId,
  } = params;

  const gpuService = getGpuService();
  let rentedInstanceId = null;
  let insertedMachineId = null;

  try {
    const instance = await provisionGpuInstance(gpuService, {
      gpuLine,
      label: `gpuvietnam-${userId.slice(0, 8)}`,
      env: workstationContainerEnv,
    });

    if (!instance?.id) {
      await persistMachineSubscriptionStatus(supabaseAdmin, subscriptionId, { serverStatus: 'offline' });
      console.error('[user/start-provision] Vast returned no instance id');
      return;
    }

    rentedInstanceId = String(instance.id);
    const machineRow = mapGpuInstanceToMachineRow(instance, {
      gpuLine,
      region: instance.region,
      subscriptionId,
      template: envName,
    });

    const machine = await insertMachineRecord(supabaseAdmin, userId, machineRow);
    insertedMachineId = machine.id;

    runMachineTransition(
      snapshotToMachineRecord(subscription, null, userId),
      MACHINE_COMMAND.MACHINE_ROW_INSERTED,
      lifecycleCtx,
      {
        machineId: machine.id,
        instanceId: machine.instance_id,
        status: machine.status,
        template: envName,
        created_at: machine.created_at,
      },
    );

    await createProvisioningPendingSession(supabaseAdmin, {
      userId,
      machine,
      subscription,
      template: envName,
      plan: planName,
      billing: subscription.billing ?? selected.billing ?? 'combo1',
      gpuConfig: getGpuLabel(planKey),
    });

    const liveStatus = await resolveLiveMachineStatus(gpuService, machine);
    const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, machine, liveStatus);

    if (liveStatus.status === 'running') {
      await persistProviderRunning(
        supabaseAdmin,
        subscriptionId,
        snapshotToMachineRecord(subscription, syncedMachine, userId),
        lifecycleCtx,
      );
    }
  } catch (gpuError) {
    console.error('[user/start-provision] failed:', gpuError);
    if (rentedInstanceId) {
      try {
        await rollbackProvisionAfterRentFailure(supabaseAdmin, gpuService, {
          userId,
          subscriptionId,
          instanceId: rentedInstanceId,
          machineId: insertedMachineId,
          correlationId,
          reason: 'start_machine_post_rent_failed',
        });
      } catch (rollbackError) {
        console.warn('[user/start-provision] rollback failed:', rollbackError);
      }
    } else {
      try {
        await persistMachineSubscriptionStatus(supabaseAdmin, subscriptionId, { serverStatus: 'offline' });
      } catch (rollbackError) {
        console.warn('[user/start-provision] offline rollback failed:', rollbackError);
      }
    }
    void formatGpuUserMessage(gpuError);
  }
}