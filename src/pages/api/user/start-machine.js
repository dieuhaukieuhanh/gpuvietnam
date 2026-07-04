import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';

import { formatGpuUserMessage, getGpuService, provisionGpuInstance, repairUserBillingState, resolveGpuLineFromPlan, createProvisioningPendingSession } from '@/lib/gpu';

import { getGpuLabel, getPlanNameFromKey } from '@/lib/gpu-pricing';

import { buildWorkstationContainerEnv, resolveEnvName } from '@/lib/workstation-env';

import {

  extractEndpointFromMachine,

  getActiveMachineForUser,

  insertMachineRecord,

  mapGpuInstanceToMachineRow,

  resolveLiveMachineStatus,

  syncMachineFromLiveStatus,

  updateSubscriptionServerStatus,

  destroyUserMachine,

} from '@/lib/machines';

import { getSupabaseAdmin } from '@/lib/supabase-admin';

import { activateInventoryPlan } from '@/lib/user-plan-inventory';

import { fetchUserActivePlans, findActivePlanSelection, normalizePlanKey } from '@/lib/user-active-plans';



function buildMachineResponse(machine, liveStatus) {

  const endpoint = extractEndpointFromMachine(machine);

  return {

    instanceId: machine?.instance_id ?? liveStatus?.instanceId ?? null,

    machineId: machine?.instance_id ?? liveStatus?.instanceId ?? null,

    ip: liveStatus?.ip ?? endpoint.ip,

    port: liveStatus?.port ?? endpoint.port,

    status: liveStatus?.status ?? machine?.status ?? 'creating',

    comfyUrl: liveStatus?.comfyUrl ?? endpoint.comfyUrl,

    message: liveStatus?.message ?? null,

  };

}



/**

 * @param {Record<string, unknown> | null | undefined} machine

 * @param {Awaited<ReturnType<typeof resolveLiveMachineStatus>> | null | undefined} liveStatus

 */

function shouldRetryProvisioning(machine, liveStatus) {

  if (!machine) return true;

  if (!machine.instance_id) return true;

  if (machine.status === 'error') return true;

  if (liveStatus?.status === 'error') return true;



  const createdAt = machine.created_at ? new Date(String(machine.created_at)).getTime() : 0;

  const ageMs = createdAt > 0 ? Date.now() - createdAt : 0;

  if (ageMs > 15 * 60 * 1000 && liveStatus?.status !== 'running') {

    return true;

  }



  return false;

}



export default async function handler(req, res) {

  if (req.method !== 'POST') {

    return res.status(405).json({ error: 'Method not allowed' });

  }



  try {

    const user = await getAuthUserFromRequest(req);

    if (!user) return unauthorized(res);



    console.info('=====================================');

    console.info('🚀 START MACHINE REQUEST');

    console.info('Time:', new Date().toISOString());

    console.info('User ID:', user.id);

    console.info('Body request:', JSON.stringify(req.body ?? {}, null, 2));

    console.info('=====================================');



    const { planId, type, plan, inventoryId } = req.body ?? {};

    const supabaseAdmin = getSupabaseAdmin();

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



    const { data: subscription, error: subError } = await supabaseAdmin

      .from('subscriptions')

      .select('id, status, server_status, env_name')

      .eq('user_id', user.id)

      .eq('status', 'active')

      .order('created_at', { ascending: false })

      .limit(1)

      .maybeSingle();



    if (subError) throw subError;

    if (!subscription) {

      return res.status(400).json({ error: 'Không tìm thấy gói chính để khởi động máy.' });

    }



    console.info('📦 Subscription loaded:');

    console.info('subscription:', JSON.stringify(subscription, null, 2));

    console.info('env_name:', subscription.env_name);

    console.info('server_status:', subscription.server_status);



    const gpuService = getGpuService();

    await repairUserBillingState(supabaseAdmin, user.id);

    const existingMachine = await getActiveMachineForUser(supabaseAdmin, user.id);



    if (subscription.server_status === 'online' && existingMachine) {

      const liveStatus = await resolveLiveMachineStatus(gpuService, existingMachine);

      await syncMachineFromLiveStatus(supabaseAdmin, existingMachine, liveStatus);

      return res.status(200).json({

        success: true,

        alreadyOnline: true,

        message: 'Máy đang chạy.',

        selectedPlan: selected,

        machine: buildMachineResponse(existingMachine, liveStatus),

      });

    }



    if (subscription.server_status === 'provisioning' && existingMachine) {

      const liveStatus = await resolveLiveMachineStatus(gpuService, existingMachine);

      await syncMachineFromLiveStatus(supabaseAdmin, existingMachine, liveStatus);



      if (!shouldRetryProvisioning(existingMachine, liveStatus)) {

        return res.status(200).json({

          success: true,

          message: 'Đang khởi động máy GPU...',

          selectedPlan: selected,

          machine: buildMachineResponse(existingMachine, liveStatus),

        });

      }



      console.warn('[user/start-machine] Stale provisioning detected, retrying Vast rent');

      await destroyUserMachine(supabaseAdmin, gpuService, user.id, {

        interrupted: true,

        skipBackup: true,

        skipBilling: String(existingMachine.status ?? '') !== 'running',

        reason: 'retry_provision',

      });

    }



    if (subscription.server_status === 'provisioning' && !existingMachine) {

      console.info('[user/start-machine] Resuming provisioning (no machine row yet)');

    }



    const planKey = normalizePlanKey(selected.plan);

    const planName = getPlanNameFromKey(planKey) ?? selected.plan;

    const gpuLine = resolveGpuLineFromPlan(planKey);

    const envName = resolveEnvName(subscription.env_name);

    const workstationContainerEnv = buildWorkstationContainerEnv(envName);



    console.info('🔧 Resolved start-machine context:');

    console.info('planKey:', planKey);

    console.info('gpuLine:', gpuLine);

    console.info('envName:', envName);

    console.info('buildWorkstationContainerEnv(envName):', JSON.stringify(workstationContainerEnv, null, 2));



    const { data: updated, error: updateError } = await supabaseAdmin

      .from('subscriptions')

      .update({

        server_status: 'provisioning',

        plan: planName,

        gpu_label: getGpuLabel(planKey),

      })

      .eq('id', subscription.id)

      .select('id, server_status, plan, gpu_label')

      .single();



    if (updateError) throw updateError;



    let instance;

    try {

      console.info('=====================================');

      console.info('🖥️ Creating Vast Instance...');

      console.info('=====================================');



      instance = await provisionGpuInstance(gpuService, {

        gpuLine,

        label: `gpuvietnam-${user.id.slice(0, 8)}`,

        env: workstationContainerEnv,

      });



      console.info('✅ Vast instance provisioned:');

      console.info('instance:', JSON.stringify(instance, null, 2));

    } catch (gpuError) {

      await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');

      return res.status(503).json({

        error: formatGpuUserMessage(gpuError),

      });

    }



    if (!instance.id) {

      await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');

      return res.status(503).json({

        error: 'Vast.ai không trả về mã instance. Kiểm tra VAST_AI_KEY và thử lại.',

      });

    }



    const machineRow = mapGpuInstanceToMachineRow(instance, {

      gpuLine,

      region: instance.region,

      subscriptionId: subscription.id,

      template: envName,

    });



    await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'provisioning');



    const machine = await insertMachineRecord(supabaseAdmin, user.id, machineRow);



    console.info('📦 Machine record inserted:');

    console.info('machine:', JSON.stringify(machine, null, 2));

    try {
      await createProvisioningPendingSession(supabaseAdmin, {
        userId: user.id,
        machine,
        subscription,
        template: envName,
        plan: planName,
        billing: subscription.billing ?? selected.billing ?? 'combo1',
        gpuConfig: getGpuLabel(planKey),
      });
    } catch (sessionError) {
      console.warn('[user/start-machine] createProvisioningPendingSession failed:', sessionError);
    }



    const liveStatus = await resolveLiveMachineStatus(gpuService, machine);

    await syncMachineFromLiveStatus(supabaseAdmin, machine, liveStatus);



    console.info('🖥️ resolveLiveMachineStatus result:');

    console.info('liveStatus:', JSON.stringify(liveStatus, null, 2));

    console.info('liveStatus.status:', liveStatus.status);



    if (liveStatus.status === 'running') {
      await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'online');
    }

    // Runtime workstation switching disabled (Restart-only architecture).
    // Container applies workspace at boot via setup-workstation.sh + buildWorkstationContainerEnv().

    return res.status(200).json({

      success: true,

      message: `Đang khởi động máy với gói ${planName}.`,

      selectedPlan: selected,

      subscription: updated,

      machine: buildMachineResponse(machine, liveStatus),

    });

  } catch (err) {

    console.error('❌ FULL ERROR');

    console.error('message:', err instanceof Error ? err.message : String(err));

    console.error('stack:', err instanceof Error ? err.stack : '(no stack)');

    console.error('[user/start-machine]', err);

    return res.status(500).json({ error: err.message || 'Không khởi động được máy.' });

  }

}

