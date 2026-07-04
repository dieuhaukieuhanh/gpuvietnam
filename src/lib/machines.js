import { DEFAULT_GPU_PORT } from '@/lib/gpu/gpu-config';
import {
  createProviderVerifyPortFromGpuService,
  verifyProviderState,
} from '@/lib/gpu/provider-verify';
import { runUnifiedDestroy } from '@/lib/destroy-pipeline';
import { parseGpuInstanceEndpoint } from '@/lib/gpu/providers/vast/vast-mapper';
import {
  shouldRepairBootingSubscriptionDrift,
  shouldResetIdleProvisioningSubscription,
  shouldSkipDeadInstanceDestroyDuringBoot,
} from './machines-provisioning-sync.js';

export const ACTIVE_MACHINE_STATUSES = ['creating', 'starting', 'running'];

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function getActiveMachineForUser(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('machines')
    .select('*')
    .eq('user_id', userId)
    .in('status', ACTIVE_MACHINE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * @param {Record<string, unknown> | null | undefined} machine
 */
export function extractEndpointFromMachine(machine) {
  const ip = typeof machine?.ip_address === 'string' ? machine.ip_address : null;
  const port = Number(machine?.port ?? DEFAULT_GPU_PORT);
  if (!ip) {
    return { ip: null, port, comfyUrl: null };
  }
  const comfyUrl = `http://${ip}:${port}`;
  return { ip, port, comfyUrl };
}

/**
 * @param {import('./gpu/domain/gpu-instance').GPUInstance} instance
 * @param {{ gpuLine: string; region?: string; subscriptionId?: string; template?: string }} context
 */
export function mapGpuInstanceToMachineRow(instance, context) {
  const endpoint = parseGpuInstanceEndpoint(instance, DEFAULT_GPU_PORT);
  const statusCode = instance.status?.code ?? 'unknown';

  /** @type {'creating' | 'starting' | 'running' | 'error'} */
  let status = 'creating';
  if (statusCode === 'failed') status = 'error';
  else if (statusCode === 'running') status = 'starting';
  else if (statusCode === 'starting') status = 'creating';

  return {
    instance_id: instance.id,
    provider: instance.providerId ?? 'vast',
    ip_address: endpoint.ip,
    port: endpoint.port,
    status,
    gpu_type: context.gpuLine,
    gpu_line: context.gpuLine,
    region: instance.region ?? context.region ?? null,
    subscription_id: context.subscriptionId ?? null,
    template: context.template ?? null,
    error_message: status === 'error' ? instance.status?.message ?? 'GPU failed' : null,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {Record<string, unknown>} row
 */
export async function insertMachineRecord(supabaseAdmin, userId, row) {
  const { data, error } = await supabaseAdmin
    .from('machines')
    .insert({
      user_id: userId,
      ...row,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} machineId
 * @param {Record<string, unknown>} patch
 */
export async function updateMachineRecord(supabaseAdmin, machineId, patch) {
  const { data, error } = await supabaseAdmin
    .from('machines')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', machineId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

/**
 * @param {Record<string, unknown>} machine
 */
function isMachineBooting(machine) {
  const status = String(machine.status ?? 'creating');
  return status === 'creating' || status === 'starting';
}

export {
  shouldRepairBootingSubscriptionDrift,
  shouldResetIdleProvisioningSubscription,
  shouldSkipDeadInstanceDestroyDuringBoot,
} from './machines-provisioning-sync.js';

/**
 * @param {import('@/lib/gpu/gpu-service').GPUService} gpuService
 * @param {Record<string, unknown>} machine
 */
export async function resolveLiveMachineStatus(gpuService, machine) {
  const instanceId = String(machine.instance_id ?? '');
  if (!instanceId) {
    return {
      status: 'error',
      message: 'Thiếu instance ID',
      ...extractEndpointFromMachine(machine),
      instanceId: null,
    };
  }

  try {
    const instance = await gpuService.getInstanceStatus(instanceId);
    const endpoint = parseGpuInstanceEndpoint(instance, Number(machine.port ?? DEFAULT_GPU_PORT));
    const code = instance.status?.code ?? 'unknown';

    if (code === 'failed') {
      return {
        status: 'error',
        message: instance.status?.message ?? 'Khởi tạo máy thất bại',
        instanceId,
        ...endpoint,
      };
    }

    if (code === 'starting' || code === 'unknown' || code === 'stopped') {
      return {
        status: 'creating',
        message: 'Đang khởi tạo máy...',
        instanceId,
        ...endpoint,
      };
    }

    let health = null;
    try {
      health = await gpuService.healthCheck(instanceId);
    } catch (healthError) {
      const message = healthError instanceof Error ? healthError.message : String(healthError);
      if (/network|timeout|ECONN/i.test(message)) {
        if (isMachineBooting(machine)) {
          return {
            status: 'starting',
            message: 'Đang khởi động ComfyUI...',
            instanceId,
            ...endpoint,
          };
        }
        return {
          status: 'disconnected',
          message: 'Mất kết nối',
          instanceId,
          ...endpoint,
        };
      }
    }

    if (health?.healthy) {
      return {
        status: 'running',
        message: 'ComfyUI sẵn sàng',
        instanceId,
        ...endpoint,
      };
    }

    return {
      status: 'starting',
      message: 'Đang khởi động ComfyUI...',
      instanceId,
      ...endpoint,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/network|timeout|ECONN/i.test(message)) {
      if (isMachineBooting(machine)) {
        return {
          status: 'starting',
          message: 'Đang khởi động ComfyUI...',
          instanceId,
          ...extractEndpointFromMachine(machine),
        };
      }
      return {
        status: 'disconnected',
        message: 'Mất kết nối',
        instanceId,
        ...extractEndpointFromMachine(machine),
      };
    }

    return {
      status: 'error',
      message: message || 'Không lấy được trạng thái máy',
      instanceId,
      ...extractEndpointFromMachine(machine),
    };
  }
}

/**
 * Provider Verification (M4) — live normalized state for a machine row.
 * Uses Provider Adapter only; does not write DB or session status.
 * @param {import('@/lib/gpu/gpu-service').GPUService} gpuService
 * @param {Record<string, unknown>} machine
 * @param {{ now?: string }} [options]
 */
export async function resolveVerifiedProviderState(gpuService, machine, options = {}) {
  const instanceId = String(machine.instance_id ?? '');
  const port = createProviderVerifyPortFromGpuService(gpuService);
  return verifyProviderState(instanceId, port, options);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {import('@/lib/gpu/gpu-service').GPUService} gpuService
 * @param {string} userId
 * @param {{
 *   interrupted?: boolean;
 *   skipBilling?: boolean;
 *   reason?: string;
 *   skipBackup?: boolean;
 *   notifyBackupStart?: boolean;
 * }} [options]
 */
export async function destroyUserMachine(supabaseAdmin, gpuService, userId, options = {}) {
  const result = await runUnifiedDestroy(supabaseAdmin, gpuService, userId, options);

  if (!result.destroyed && result.outcome === 'no_machine') {
    await resetProvisioningSubscription(supabaseAdmin, userId);
  }

  return {
    destroyed: result.destroyed,
    machine: result.machine,
    billingResult: result.billingResult,
    metrics: result.metrics,
    backupSuccess: result.backupSuccess,
    reason: result.reason,
    settlementStatus: result.settlementStatus ?? null,
    verifiedDestroyedAt: result.verifiedDestroyedAt ?? null,
    verifyStatus: result.verify?.state ?? null,
    verify: result.verify ?? null,
    outcome: result.outcome,
    retryable: result.retryable,
    lastStep: result.lastStep,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} machine
 * @param {{ status: string; ip?: string | null; port?: number; message?: string }} live
 */
export async function syncMachineFromLiveStatus(supabaseAdmin, machine, live) {
  /** @type {string} */
  let status = String(machine.status ?? 'creating');
  if (live.status === 'running') status = 'running';
  else if (live.status === 'error') status = 'error';
  else if (live.status === 'starting') status = 'starting';
  else if (live.status === 'creating') status = 'creating';

  const patch = {
    status,
    ip_address: live.ip ?? machine.ip_address,
    port: live.port ?? machine.port,
    error_message: live.status === 'error' ? live.message ?? null : null,
  };

  return updateMachineRecord(supabaseAdmin, String(machine.id), patch);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} subscriptionId
 * @param {'online' | 'offline' | 'provisioning'} serverStatus
 */
export async function updateSubscriptionServerStatus(supabaseAdmin, subscriptionId, serverStatus) {
  const { error } = await supabaseAdmin
    .from('subscriptions')
    .update({ server_status: serverStatus })
    .eq('id', subscriptionId);

  if (error) throw error;
}

const STALE_BOOT_MS = 15 * 60 * 1000;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} machine
 */
async function markMachineDestroyedLocal(supabaseAdmin, machine) {
  await supabaseAdmin
    .from('machines')
    .update({
      status: 'destroyed',
      stopped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', machine.id);
}

async function fetchActiveSubscription(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('id, server_status, status, created_at')
    .eq('user_id', userId)
    .in('status', ['active', 'provisioning'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Reset subscription stuck in provisioning when no active machine exists.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function reconcileOrphanedProvisioning(supabaseAdmin, userId) {
  const machine = await getActiveMachineForUser(supabaseAdmin, userId);
  if (machine) {
    return { reconciled: false, reason: 'active_machine_exists' };
  }

  const { data: subscription, error } = await supabaseAdmin
    .from('subscriptions')
    .select('id, server_status')
    .eq('user_id', userId)
    .in('status', ['active', 'provisioning'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!subscription || subscription.server_status !== 'provisioning') {
    return { reconciled: false, reason: 'not_provisioning' };
  }

  await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');
  return { reconciled: true, subscriptionId: subscription.id };
}

/**
 * Keep subscription.server_status aligned with active machine rows and Vast instance reality.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {import('@/lib/gpu/gpu-service').GPUService | null | undefined} gpuService
 * @param {string} userId
 */
export async function syncSubscriptionWithMachineState(supabaseAdmin, gpuService, userId) {
  let machine = await getActiveMachineForUser(supabaseAdmin, userId);
  const subscription = await fetchActiveSubscription(supabaseAdmin, userId);

  if (!subscription) {
    return { changed: false, machine, subscription: null, action: null };
  }

  if (machine && subscription.server_status === 'offline') {
    if (shouldRepairBootingSubscriptionDrift(machine, subscription.server_status)) {
      await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'provisioning');
      return {
        changed: true,
        machine,
        subscription: { ...subscription, server_status: 'provisioning' },
        action: 'repaired_booting_subscription',
      };
    }

    if (!gpuService) {
      await markMachineDestroyedLocal(supabaseAdmin, machine);
      return {
        changed: true,
        machine: null,
        subscription,
        action: 'destroyed_leaked_machine_local',
      };
    }

    await destroyUserMachine(supabaseAdmin, gpuService, userId, {
      skipBackup: true,
      interrupted: true,
      reason: 'user_stop',
    });

    return {
      changed: true,
      machine: null,
      subscription: { ...subscription, server_status: 'offline' },
      action: 'destroyed_leaked_machine',
    };
  }

  if (!machine) {
    if (subscription.server_status === 'online') {
      await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');
      return {
        changed: true,
        machine: null,
        subscription: { ...subscription, server_status: 'offline' },
        action: 'reset_orphan_online',
      };
    }

    if (shouldResetIdleProvisioningSubscription(machine, subscription.server_status)) {
      await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');
      return {
        changed: true,
        machine: null,
        subscription: { ...subscription, server_status: 'offline' },
        action: 'reset_idle_provisioning',
      };
    }

    return { changed: false, machine: null, subscription, action: null };
  }

  if (machine && !machine.instance_id) {
    await markMachineDestroyedLocal(supabaseAdmin, machine);
    if (subscription.server_status !== 'offline') {
      await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');
    }
    return {
      changed: true,
      machine: null,
      subscription: { ...subscription, server_status: 'offline' },
      action: 'reset_invalid_machine_row',
    };
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
      if (liveStatus.status === 'error' || liveStatus.status !== 'running') {
        await destroyUserMachine(supabaseAdmin, gpuService, userId, {
          skipBackup: true,
          interrupted: true,
          reason: 'user_stop',
        });
        await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');
        return {
          changed: true,
          machine: null,
          subscription: { ...subscription, server_status: 'offline' },
          action: 'reset_stale_boot',
        };
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
          return { changed: false, machine, subscription, action: null };
        }

        await destroyUserMachine(supabaseAdmin, gpuService, userId, {
          skipBackup: true,
          interrupted: true,
          reason: 'user_stop',
        });
        await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');

        return {
          changed: true,
          machine: null,
          subscription: { ...subscription, server_status: 'offline' },
          action: 'destroyed_dead_instance',
        };
      }
    }
  }

  return { changed: false, machine, subscription, action: null };
}

/**
 * Force subscription offline when user cancels or stops while provisioning.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function resetProvisioningSubscription(supabaseAdmin, userId) {
  const { data: subscription, error } = await supabaseAdmin
    .from('subscriptions')
    .select('id, server_status')
    .eq('user_id', userId)
    .in('status', ['active', 'provisioning'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!subscription || subscription.server_status !== 'provisioning') {
    return { reset: false };
  }

  await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');
  return { reset: true, subscriptionId: subscription.id };
}
