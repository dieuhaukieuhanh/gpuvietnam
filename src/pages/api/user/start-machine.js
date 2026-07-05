import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';

import {
  getGpuService,
  repairUserBillingState,
  resolveGpuLineFromPlan,
  snapshotToMachineRecord,
  resolveMachineSessionView,
  persistStartRequested,
} from '@/lib/gpu';
import {
  isMachineBooting,
  isRecentBootMachine,
  shouldRepairBootingSubscriptionDrift,
  shouldRetryProvisioningForBoot,
} from '@/lib/machines-provisioning-sync';

import { getGpuLabel, getPlanNameFromKey } from '@/lib/gpu-pricing';

import { buildWorkstationContainerEnv, isGpuComfyWorkstation, resolveEnvName } from '@/lib/workstation-env';
import { WORKSTATIONS } from '@/lib/workstations';

import { buildConsumerEndpoint } from '@/lib/endpoint-utils';

import { createCorrelationId } from '@/lib/scb-correlation';

import {
  getActiveMachineForUser,
  resolveLiveMachineStatus,
  syncMachineFromLiveStatus,
  updateSubscriptionServerStatus,
  destroyUserMachine,
} from '@/lib/machines';

import { getSupabaseAdmin } from '@/lib/supabase-admin';

import { completeUserStartProvision } from '@/lib/gpu/user-start-provision';
import { resolveBillingViewForCommand } from '@/lib/gpu/billing-session-view';

import { activateInventoryPlan } from '@/lib/user-plan-inventory';

import { fetchUserActivePlans, findActivePlanSelection, normalizePlanKey } from '@/lib/user-active-plans';



function buildMachineResponse(machine, liveStatus) {
  const healthOk = liveStatus?.healthOk === true;
  const endpoint = buildConsumerEndpoint(machine, healthOk);

  return {
    instanceId: machine?.instance_id ?? liveStatus?.instanceId ?? null,
    machineId: machine?.instance_id ?? liveStatus?.instanceId ?? null,
    ip: endpoint.ip,
    port: endpoint.port,
    status: liveStatus?.status ?? machine?.status ?? 'creating',
    comfyUrl: endpoint.comfyUrl,
    template: machine?.template ? String(machine.template) : null,
    message: liveStatus?.message ?? null,
  };
}

function buildMachineSessionView(subscription, machine, userId, options = {}) {
  const record = snapshotToMachineRecord(subscription, machine, userId);
  return resolveMachineSessionView(record, {
    envName: subscription?.env_name ?? null,
    ...options,
  });
}

async function billingViewForStart(supabaseAdmin, userId, gpuService, machineSessionView, machine) {
  return resolveBillingViewForCommand(supabaseAdmin, userId, {
    machineSessionView,
    machine: machine ?? null,
    gpuService,
  });
}

function machineLifecycleContext(subscription) {
  return { subscriptionActive: subscription?.status === 'active' };
}



export default async function handler(req, res) {

  if (req.method !== 'POST') {

    return res.status(405).json({ error: 'Method not allowed' });

  }



  const correlationId = createCorrelationId();

  let rentedInstanceId = null;

  let insertedMachineId = null;

  let provisioningSubscriptionId = null;

  let userId = null;

  /** @type {import('@/lib/gpu/gpu-service').GPUService | null} */

  let gpuService = null;

  const supabaseAdmin = getSupabaseAdmin();



  try {

    const user = await getAuthUserFromRequest(req);

    if (!user) return unauthorized(res);

    userId = user.id;



    console.info('=====================================');

    console.info('🚀 START MACHINE REQUEST');

    console.info('Time:', new Date().toISOString());

    console.info('User ID:', user.id);

    console.info('Body request:', JSON.stringify(req.body ?? {}, null, 2));

    console.info('=====================================');



    const { planId, type, plan, inventoryId, envName: requestedEnvNameRaw } = req.body ?? {};

    const { plans } = await fetchUserActivePlans(supabaseAdmin, user.id);



    const selected = findActivePlanSelection(plans, {

      planId,

      type,

      plan,

      inventoryId,

    });

    if (!selected) {

      return res.status(400).json({ error: 'Gói đã chọn không còn hợp lệ.' });

    }



    if (selected.inventoryId) {

      await activateInventoryPlan(supabaseAdmin, user.id, selected.inventoryId);

    }



    const { data: subscriptionRow, error: subError } = await supabaseAdmin

      .from('subscriptions')

      .select('id, status, server_status, env_name, billing')

      .eq('user_id', user.id)

      .eq('status', 'active')

      .order('created_at', { ascending: false })

      .limit(1)

      .maybeSingle();



    if (subError) throw subError;

    if (!subscriptionRow) {

      return res.status(400).json({ error: 'Không tìm thấy gói chính để khởi động máy.' });

    }

    let subscription = subscriptionRow;

    const requestedEnvName =
      typeof requestedEnvNameRaw === 'string' && requestedEnvNameRaw.trim()
        ? requestedEnvNameRaw.trim()
        : null;
    if (requestedEnvName) {
      const workstation = WORKSTATIONS.find((item) => item.name === requestedEnvName);
      if (!workstation || !isGpuComfyWorkstation(workstation)) {
        return res.status(400).json({
          error:
            'Môi trường không hợp lệ. Hiện chỉ hỗ trợ 3 môi trường ComfyUI: Character & Art, Commerce & Product, Video AI.',
        });
      }
      if (workstation.name !== subscription.env_name) {
        const { data: envUpdated, error: envUpdateError } = await supabaseAdmin
          .from('subscriptions')
          .update({
            env_name: workstation.name,
            env_icon: workstation.icon,
            env_desc: workstation.desc,
          })
          .eq('id', subscription.id)
          .select('id, status, server_status, env_name, billing')
          .single();
        if (envUpdateError) throw envUpdateError;
        subscription = { ...subscription, ...envUpdated };
        console.info('[user/start-machine] Synced subscription env before boot:', workstation.name);
      }
    }

    const targetEnvName = resolveEnvName(requestedEnvName ?? subscription.env_name);

    console.info('📦 Subscription loaded:');

    console.info('subscription:', JSON.stringify(subscription, null, 2));

    console.info('env_name:', subscription.env_name);

    console.info('server_status:', subscription.server_status);



    gpuService = getGpuService();

    await repairUserBillingState(supabaseAdmin, user.id);

    let existingMachine = await getActiveMachineForUser(supabaseAdmin, user.id);



    if (existingMachine && subscription.server_status === 'offline') {
      if (shouldRepairBootingSubscriptionDrift(existingMachine, subscription.server_status)) {
        await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'provisioning');
        subscription = { ...subscription, server_status: 'provisioning' };
      } else if (!isMachineBooting(existingMachine) || !isRecentBootMachine(existingMachine)) {
        console.warn('[user/start-machine] Stale leaked machine while offline — destroying before boot');
        await destroyUserMachine(supabaseAdmin, gpuService, user.id, {
          interrupted: true,
          skipBackup: true,
          skipBilling: String(existingMachine.status ?? '') !== 'running',
          reason: 'retry_provision',
        });
        existingMachine = null;
      }
    }

    if (subscription.server_status === 'online' && existingMachine) {

      const liveStatus = await resolveLiveMachineStatus(gpuService, existingMachine);

      if (liveStatus.status === 'running') {

        const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, existingMachine, liveStatus);

        const machineSessionView = buildMachineSessionView(
            subscription,
            syncedMachine,
            user.id,
            { comfyUrl: buildMachineResponse(syncedMachine, liveStatus).comfyUrl },
          );
        const billingView = await billingViewForStart(
          supabaseAdmin,
          user.id,
          gpuService,
          machineSessionView,
          syncedMachine,
        );

        return res.status(200).json({

          success: true,

          alreadyOnline: true,

          message: 'Máy đang chạy.',

          selectedPlan: selected,

          machine: buildMachineResponse(syncedMachine, liveStatus),

          machineSessionView,
          billingView,

        });

      }

      if (liveStatus.status === 'starting' || liveStatus.status === 'creating') {
        const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, existingMachine, liveStatus);

        if (
          shouldRetryProvisioningForBoot(existingMachine, liveStatus, targetEnvName)
        ) {
          console.warn('[user/start-machine] Boot env mismatch or stale — retrying Vast rent', {
            machineTemplate: existingMachine.template ?? null,
            targetEnvName,
          });
          await destroyUserMachine(supabaseAdmin, gpuService, user.id, {
            interrupted: true,
            skipBackup: true,
            skipBilling: String(existingMachine.status ?? '') !== 'running',
            reason: 'retry_provision',
          });
          existingMachine = null;
          await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');
          subscription = { ...subscription, server_status: 'offline' };
        } else {
          const machineSessionView = buildMachineSessionView(subscription, syncedMachine, user.id);
          const billingView = await billingViewForStart(
            supabaseAdmin,
            user.id,
            gpuService,
            machineSessionView,
            syncedMachine,
          );
          return res.status(200).json({
            success: true,
            message: 'Đang khởi động máy GPU...',
            selectedPlan: selected,
            machine: buildMachineResponse(syncedMachine, liveStatus),
            machineSessionView,
            billingView,
          });
        }
      }

      console.warn('[user/start-machine] Stale online projection — cleaning up before re-provision', {

        liveStatus: liveStatus.status,

        message: liveStatus.message ?? null,

        machineId: existingMachine.id ?? null,

        driftAction: null,

      });

      if (existingMachine) {

        await destroyUserMachine(supabaseAdmin, gpuService, user.id, {

          interrupted: true,

          skipBackup: true,

          skipBilling: String(existingMachine.status ?? '') !== 'running',

          reason: 'retry_provision',

        });

        existingMachine = null;

      }

      await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');

      subscription = { ...subscription, server_status: 'offline' };

    }



    if (subscription.server_status === 'provisioning' && !existingMachine) {
      console.info('[user/start-machine] Boot already in progress (no machine row yet) — retry background provision');
      void completeUserStartProvision(supabaseAdmin, {
        userId: user.id,
        subscriptionId: subscription.id,
        subscription,
        selected,
        planKey: normalizePlanKey(selected.plan),
        planName: getPlanNameFromKey(normalizePlanKey(selected.plan)) ?? selected.plan,
        gpuLine: resolveGpuLineFromPlan(normalizePlanKey(selected.plan)),
        envName: targetEnvName,
        workstationContainerEnv: buildWorkstationContainerEnv(targetEnvName),
        lifecycleCtx: machineLifecycleContext(subscription),
        correlationId,
      }).catch((err) => {
        console.error('[user/start-machine] background provision retry error:', err);
      });
      const machineSessionView = buildMachineSessionView(subscription, null, user.id);
      const billingView = await billingViewForStart(
        supabaseAdmin,
        user.id,
        gpuService,
        machineSessionView,
        null,
      );
      return res.status(200).json({
        success: true,
        alreadyStarting: true,
        message: 'Đang khởi tạo máy GPU. Vui lòng đợi...',
        selectedPlan: selected,
        machineSessionView,
        billingView,
      });
    }

    if (subscription.server_status === 'provisioning' && existingMachine) {

      const liveStatus = await resolveLiveMachineStatus(gpuService, existingMachine);

      const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, existingMachine, liveStatus);



      if (!shouldRetryProvisioningForBoot(existingMachine, liveStatus, targetEnvName)) {
        const machineSessionView = buildMachineSessionView(subscription, syncedMachine, user.id);
        const billingView = await billingViewForStart(
          supabaseAdmin,
          user.id,
          gpuService,
          machineSessionView,
          syncedMachine,
        );

        return res.status(200).json({

          success: true,

          message: 'Đang khởi động máy GPU...',

          selectedPlan: selected,

          machine: buildMachineResponse(syncedMachine, liveStatus),

          machineSessionView,
          billingView,

        });

      }



      console.warn('[user/start-machine] Stale provisioning or env mismatch — retrying Vast rent', {
        machineTemplate: existingMachine.template ?? null,
        targetEnvName,
      });

      await destroyUserMachine(supabaseAdmin, gpuService, user.id, {

        interrupted: true,

        skipBackup: true,

        skipBilling: String(existingMachine.status ?? '') !== 'running',

        reason: 'retry_provision',

      });

    }



    const planKey = normalizePlanKey(selected.plan);

    const planName = getPlanNameFromKey(planKey) ?? selected.plan;

    const gpuLine = resolveGpuLineFromPlan(planKey);

    const envName = targetEnvName;

    const workstationContainerEnv = buildWorkstationContainerEnv(envName);



    console.info('🔧 Resolved start-machine context:');

    console.info('planKey:', planKey);

    console.info('gpuLine:', gpuLine);

    console.info('envName:', envName);

    console.info('buildWorkstationContainerEnv(envName):', JSON.stringify(workstationContainerEnv, null, 2));



    const lifecycleCtx = machineLifecycleContext(subscription);
    const lifecycleRecord = snapshotToMachineRecord(subscription, existingMachine, user.id);

    const startTransition = await persistStartRequested(
      supabaseAdmin,
      subscription.id,
      lifecycleRecord,
      lifecycleCtx,
      {
        userId: user.id,
        subscriptionId: subscription.id,
        envName,
      },
    );

    if (startTransition.state === 'ERROR') {
      return res.status(409).json({ error: startTransition.message });
    }

    if (startTransition.state === 'IGNORED') {
      const bootMachine = await getActiveMachineForUser(supabaseAdmin, user.id);
      const machineSessionView = buildMachineSessionView(
        { ...subscription, server_status: 'provisioning' },
        bootMachine,
        user.id,
      );
      const billingView = await billingViewForStart(
        supabaseAdmin,
        user.id,
        gpuService,
        machineSessionView,
        bootMachine,
      );
      return res.status(200).json({
        success: true,
        alreadyStarting: true,
        message: 'Đang khởi động máy GPU...',
        selectedPlan: selected,
        machine: bootMachine ? buildMachineResponse(bootMachine, { status: bootMachine.status ?? 'creating' }) : null,
        machineSessionView,
        billingView,
      });
    }

    subscription = {
      ...subscription,
      server_status: startTransition.machine?.serverStatus ?? 'provisioning',
      plan: planName,
      gpu_label: getGpuLabel(planKey),
    };

    provisioningSubscriptionId = subscription.id;

    await supabaseAdmin
      .from('subscriptions')
      .update({ plan: planName, gpu_label: getGpuLabel(planKey) })
      .eq('id', subscription.id);

    const openingView = buildMachineSessionView(subscription, null, user.id, {
      envName,
    });

    const billingView = await billingViewForStart(
      supabaseAdmin,
      user.id,
      gpuService,
      openingView,
      null,
    );

    res.status(200).json({
      success: true,
      accepted: true,
      message: 'Đang khởi tạo máy GPU...',
      selectedPlan: selected,
      subscription: {
        id: subscription.id,
        server_status: subscription.server_status,
        plan: planName,
        gpu_label: getGpuLabel(planKey),
      },
      machineSessionView: openingView,
      billingView,
    });

    void completeUserStartProvision(supabaseAdmin, {
      userId: user.id,
      subscriptionId: subscription.id,
      subscription,
      selected,
      planKey,
      planName,
      gpuLine,
      envName,
      workstationContainerEnv,
      lifecycleCtx,
      correlationId,
    }).catch((err) => {
      console.error('[user/start-machine] background provision error:', err);
    });

    return;
  } catch (err) {

    console.error('❌ FULL ERROR');

    console.error('message:', err instanceof Error ? err.message : String(err));

    console.error('stack:', err instanceof Error ? err.stack : '(no stack)');

    console.error('[user/start-machine]', err);



    if (rentedInstanceId && userId && gpuService && provisioningSubscriptionId) {

      try {

        await rollbackProvisionAfterRentFailure(supabaseAdmin, gpuService, {

          userId,

          subscriptionId: provisioningSubscriptionId,

          instanceId: rentedInstanceId,

          machineId: insertedMachineId,

          correlationId,

          reason: 'start_machine_post_rent_failed',

        });

      } catch (rollbackError) {

        console.warn('[user/start-machine] provision rollback failed:', rollbackError);

      }

    } else if (provisioningSubscriptionId) {

      try {

        await updateSubscriptionServerStatus(supabaseAdmin, provisioningSubscriptionId, 'offline');

      } catch (rollbackError) {

        console.warn('[user/start-machine] provisioning rollback failed:', rollbackError);

      }

    }



    return res.status(500).json({ error: err.message || 'Không khởi động được máy.' });

  }

}

