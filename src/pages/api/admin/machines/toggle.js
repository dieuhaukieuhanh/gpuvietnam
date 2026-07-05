import { verifyAdmin } from '@/lib/admin-auth';
import { fetchRecentAdminMachineLogs, insertAdminMachineLog } from '@/lib/admin-machine-logs';
import {
  formatGpuUserMessage,
  getGpuService,
  provisionGpuInstance,
  resolveGpuLineFromPlan,
} from '@/lib/gpu';
import { getGpuLabel, getPlanNameFromKey } from '@/lib/gpu-pricing';
import { buildWorkstationContainerEnv, resolveEnvName } from '@/lib/workstation-env';
import { buildConsumerEndpoint } from '@/lib/endpoint-utils';
import { createCorrelationId } from '@/lib/scb-correlation';
import { destroyMachineWithBackup, notifyAfterMachineDestroy } from '@/lib/machine-destroy';
import {
  getActiveMachineForUser,
  insertMachineRecord,
  mapGpuInstanceToMachineRow,
  resolveLiveMachineStatus,
  rollbackProvisionAfterRentFailure,
  syncMachineFromLiveStatus,
  updateSubscriptionServerStatus,
} from '@/lib/machines';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { activateInventoryPlan } from '@/lib/user-plan-inventory';
import { fetchUserActivePlans, normalizePlanKey } from '@/lib/user-active-plans';
import { notifyAdminMachineStarted } from '@/lib/user-notifications';

function resolveAdminId(adminCtx) {
  if (adminCtx?.mode === 'auth' && adminCtx.user?.id) {
    return adminCtx.user.id;
  }
  return null;
}

function buildMachineResponse(machine, liveStatus) {
  const healthOk = liveStatus?.healthOk === true;
  const endpoint = buildConsumerEndpoint(machine, healthOk);
  return {
    instanceId: machine?.instance_id ?? liveStatus?.instanceId ?? null,
    ip: endpoint.ip,
    port: endpoint.port,
    status: liveStatus?.status ?? machine?.status ?? 'creating',
    comfyUrl: endpoint.comfyUrl,
    message: liveStatus?.message ?? null,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
async function adminStartCustomerMachine(supabaseAdmin, userId) {
  const { plans } = await fetchUserActivePlans(supabaseAdmin, userId);
  const selected = plans[0];
  if (!selected) {
    return { status: 400, body: { error: 'Khách hàng không có gói active để khởi động máy.' } };
  }

  if (selected.inventoryId) {
    await activateInventoryPlan(supabaseAdmin, userId, selected.inventoryId);
  }

  const { data: subscription, error: subError } = await supabaseAdmin
    .from('subscriptions')
    .select('id, status, server_status, env_name')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subError) throw subError;
  if (!subscription) {
    return { status: 400, body: { error: 'Không tìm thấy subscription active của khách hàng.' } };
  }

  const gpuService = getGpuService();
  const existingMachine = await getActiveMachineForUser(supabaseAdmin, userId);

  if (subscription.server_status === 'online' && existingMachine) {
    const liveStatus = await resolveLiveMachineStatus(gpuService, existingMachine);
    const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, existingMachine, liveStatus);
    return {
      status: 200,
      body: {
        success: true,
        alreadyOnline: true,
        message: 'Máy khách hàng đang chạy.',
        machine: buildMachineResponse(syncedMachine, liveStatus),
      },
      machine: existingMachine,
    };
  }

  if (subscription.server_status === 'provisioning' && existingMachine) {
    const liveStatus = await resolveLiveMachineStatus(gpuService, existingMachine);
    const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, existingMachine, liveStatus);
    return {
      status: 200,
      body: {
        success: true,
        message: 'Máy khách hàng đang được khởi động.',
        machine: buildMachineResponse(syncedMachine, liveStatus),
      },
      machine: existingMachine,
    };
  }

  const planKey = normalizePlanKey(selected.plan);
  const planName = getPlanNameFromKey(planKey) ?? selected.plan;
  const gpuLine = resolveGpuLineFromPlan(planKey);
  const envName = resolveEnvName(subscription.env_name);

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

  const correlationId = createCorrelationId();
  let rentedInstanceId = null;
  let insertedMachineId = null;

  let instance;
  try {
    instance = await provisionGpuInstance(gpuService, {
      gpuLine,
      label: `gpuvietnam-${userId.slice(0, 8)}`,
      env: buildWorkstationContainerEnv(envName),
    });
  } catch (gpuError) {
    await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');
    return {
      status: 503,
      body: { error: formatGpuUserMessage(gpuError) },
    };
  }

  rentedInstanceId = String(instance.id);

  try {
    const machineRow = mapGpuInstanceToMachineRow(instance, {
      gpuLine,
      region: instance.region,
      subscriptionId: subscription.id,
      template: envName,
    });

    const machine = await insertMachineRecord(supabaseAdmin, userId, machineRow);
    insertedMachineId = machine.id;
    const liveStatus = await resolveLiveMachineStatus(gpuService, machine);
    const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, machine, liveStatus);

    if (liveStatus.status === 'running') {
      await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'online');
    }

    return {
      status: 200,
      body: {
        success: true,
        message: `Đang khởi động máy với gói ${planName}.`,
        selectedPlan: selected,
        subscription: updated,
        machine: buildMachineResponse(syncedMachine, liveStatus),
      },
      machine: syncedMachine,
      planName,
    };
  } catch (error) {
    await rollbackProvisionAfterRentFailure(supabaseAdmin, gpuService, {
      userId,
      subscriptionId: subscription.id,
      instanceId: rentedInstanceId,
      machineId: insertedMachineId,
      correlationId,
      reason: 'admin_start_post_rent_failed',
    });
    throw error;
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {import('@/lib/gpu/gpu-service').GPUService} gpuService
 * @param {string} userId
 */
async function adminStopCustomerMachine(supabaseAdmin, gpuService, userId) {
  const result = await destroyMachineWithBackup(supabaseAdmin, gpuService, userId, {
    reason: 'admin_stop',
  });

  if (!result.destroyed) {
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('id, server_status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subscription && subscription.server_status !== 'offline') {
      await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');
      return {
        status: 200,
        body: { success: true, message: 'Đã đặt trạng thái máy về offline.' },
        machine: null,
      };
    }

    return { status: 404, body: { error: 'Không tìm thấy máy đang chạy của khách hàng.' } };
  }

  return {
    status: 200,
    body: {
      success: true,
      message: 'Đã tắt máy khách hàng.',
      backupSuccess: result.backupSuccess,
    },
    machine: result.machine,
    backupSuccess: result.backupSuccess,
  };
}

export default async function handler(req, res) {
  const adminCtx = await verifyAdmin(req, res);
  if (!adminCtx) return;

  const supabaseAdmin = getSupabaseAdmin();

  if (req.method === 'GET') {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
    if (!userId) {
      return res.status(400).json({ error: 'Thiếu userId.' });
    }

    try {
      const logs = await fetchRecentAdminMachineLogs(supabaseAdmin, userId, 3);
      return res.status(200).json({ logs });
    } catch (err) {
      console.error('[admin/machines/toggle GET]', err);
      return res.status(500).json({ error: err.message || 'Không tải được lịch sử.' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, action, reason } = req.body ?? {};
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Thiếu userId.' });
  }
  if (action !== 'start' && action !== 'stop') {
    return res.status(400).json({ error: 'action phải là start hoặc stop.' });
  }

  const adminId = resolveAdminId(adminCtx);
  const gpuService = getGpuService();

  try {
    if (action === 'stop') {
      const stopResult = await adminStopCustomerMachine(supabaseAdmin, gpuService, userId);
      if (stopResult.status >= 400) {
        return res.status(stopResult.status).json(stopResult.body);
      }

      await insertAdminMachineLog(supabaseAdmin, {
        adminId,
        userId,
        action: 'stop',
        machineId: stopResult.machine?.id ?? null,
        reason: typeof reason === 'string' ? reason : null,
      });

      await notifyAfterMachineDestroy(
        supabaseAdmin,
        userId,
        'admin_stop',
        stopResult.backupSuccess,
      );

      return res.status(200).json(stopResult.body);
    }

    const startResult = await adminStartCustomerMachine(supabaseAdmin, userId);
    if (startResult.status >= 400) {
      return res.status(startResult.status).json(startResult.body);
    }

    if (!startResult.body.alreadyOnline) {
      await insertAdminMachineLog(supabaseAdmin, {
        adminId,
        userId,
        action: 'start',
        machineId: startResult.machine?.id ?? null,
        reason: typeof reason === 'string' ? reason : null,
      });

      await notifyAdminMachineStarted(supabaseAdmin, {
        userId,
        planName: startResult.planName ?? startResult.body.selectedPlan?.plan,
      });
    }

    return res.status(startResult.status).json(startResult.body);
  } catch (err) {
    console.error('[admin/machines/toggle]', err);
    return res.status(500).json({ error: err.message || 'Không thực hiện được thao tác máy.' });
  }
}
