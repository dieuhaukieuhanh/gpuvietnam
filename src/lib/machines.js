import { buildEndpointFromMachine, buildExternalEndpoint, INTERNAL_CONTAINER_PORT, isEndpointResolved } from '@/lib/endpoint-utils';
import { DEFAULT_GPU_PORT } from '@/lib/gpu/gpu-config';
import {
  createProviderVerifyPortFromGpuService,
  verifyProviderState,
} from '@/lib/gpu/provider-verify';
import { runUnifiedDestroy } from '@/lib/destroy-pipeline';
import { interruptPendingSessionForUser } from '@/lib/gpu/session-start';
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
  return buildEndpointFromMachine(machine);
}

/**
 * @param {import('./gpu/domain/gpu-instance').GPUInstance} instance
 * @param {{ gpuLine: string; region?: string; subscriptionId?: string; template?: string }} context
 */
export function mapGpuInstanceToMachineRow(instance, context) {
  const endpoint = parseGpuInstanceEndpoint(instance, DEFAULT_GPU_PORT);
  const port =
    endpoint.port != null &&
    endpoint.port > 0 &&
    endpoint.port !== INTERNAL_CONTAINER_PORT
      ? endpoint.port
      : null;
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
    port,
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
 * Map provider parse output to external ip/port for live status + sync.
 * DEFAULT_GPU_PORT is never exposed when machines.port is NULL.
 *
 * @param {{ ip?: string | null; port?: number | null }} parsed
 * @param {Record<string, unknown>} machine
 */
function projectLiveEndpointFields(parsed, machine) {
  if (isEndpointResolved(machine)) {
    const endpoint = buildEndpointFromMachine(machine);
    return { ip: endpoint.ip, port: endpoint.port };
  }

  const fromMachine = buildEndpointFromMachine(machine);
  const ip = parsed.ip ?? fromMachine.ip;
  const parsedPort =
    parsed.port != null &&
    parsed.port > 0 &&
    parsed.port !== INTERNAL_CONTAINER_PORT
      ? parsed.port
      : null;

  return buildExternalEndpoint(ip, parsedPort);
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
 * Compensate a failed start-machine/admin-start after Vast rent (Architecture Freeze v3.2 Phase 3).
 * Idempotent. Never calls user-wide destroy — only the rented instanceId.
 *
 * Order: destroy Vast → subscription offline → pending session cleanup → mark machine destroyed.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {import('@/lib/gpu/gpu-service').GPUService} gpuService
 * @param {{
 *   userId: string;
 *   subscriptionId: string;
 *   instanceId: string;
 *   machineId?: string | null;
 *   correlationId: string;
 *   reason?: string;
 * }} input
 */
export async function rollbackProvisionAfterRentFailure(supabaseAdmin, gpuService, input) {
  const {
    userId,
    subscriptionId,
    instanceId,
    machineId = null,
    correlationId,
    reason = 'provision_rollback',
  } = input;

  if (instanceId) {
    try {
      await gpuService.destroyInstance(String(instanceId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/404|not found|destroyed|does not exist/i.test(message)) {
        console.warn('[rollbackProvisionAfterRentFailure] destroyInstance failed:', message);
      }
    }
  }

  try {
    await updateSubscriptionServerStatus(supabaseAdmin, subscriptionId, 'offline');
  } catch (error) {
    console.warn('[rollbackProvisionAfterRentFailure] subscription rollback failed:', error);
  }

  try {
    await interruptPendingSessionForUser(supabaseAdmin, userId);
  } catch (error) {
    console.warn('[rollbackProvisionAfterRentFailure] session rollback failed:', error);
  }

  if (machineId) {
    try {
      await markMachineDestroyedLocal(supabaseAdmin, { id: machineId });
    } catch (error) {
      console.warn('[rollbackProvisionAfterRentFailure] mark machine destroyed failed:', error);
    }
  }

  console.warn('[rollbackProvisionAfterRentFailure]', {
    correlationId,
    instanceId,
    userId,
    subscriptionId,
    machineId,
    reason,
  });
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
 * @param {{ onPvTrace?: (checkpoint: string, payload: Record<string, unknown>) => void }} [options]
 */
export async function resolveLiveMachineStatus(gpuService, machine, options = {}) {
  const onPvTrace = options.onPvTrace;
  const trace = (checkpoint, payload) => {
    if (typeof onPvTrace === 'function') onPvTrace(checkpoint, payload);
  };

  const instanceId = String(machine.instance_id ?? '');
  const machineEndpoint = extractEndpointFromMachine(machine);
  if (!instanceId) {
    return {
      status: 'error',
      message: 'Thiếu instance ID',
      ip: machineEndpoint.ip,
      port: machineEndpoint.port,
      healthOk: false,
      instanceId: null,
    };
  }

  try {
    trace('gpuService.getInstanceStatus()', { phase: 'enter', instance_id: instanceId });
    const instance = await gpuService.getInstanceStatus(instanceId);
    const parsed = parseGpuInstanceEndpoint(instance, DEFAULT_GPU_PORT);
    const { ip, port } = projectLiveEndpointFields(parsed, machine);
    const code = instance.status?.code ?? 'unknown';
    trace('gpuService.getInstanceStatus()', {
      phase: 'result',
      instance_id: instanceId,
      provider_code: code,
      ip,
      port,
    });

    if (code === 'failed') {
      return {
        status: 'error',
        message: instance.status?.message ?? 'Khởi tạo máy thất bại',
        instanceId,
        ip,
        port,
        healthOk: false,
      };
    }

    if (code === 'starting' || code === 'unknown' || code === 'stopped') {
      return {
        status: 'creating',
        message: 'Đang khởi tạo máy...',
        instanceId,
        ip,
        port,
        healthOk: false,
      };
    }

    let health = null;
    try {
      trace('gpuService.healthCheck()', { phase: 'enter', instance_id: instanceId, ip, port });
      health = await gpuService.healthCheck(instanceId);
      trace('gpuService.healthCheck()', {
        phase: 'result',
        instance_id: instanceId,
        healthy: health?.healthy ?? null,
        ip,
        port,
      });
    } catch (healthError) {
      const message = healthError instanceof Error ? healthError.message : String(healthError);
      if (/network|timeout|ECONN/i.test(message)) {
        if (isMachineBooting(machine)) {
          return {
            status: 'starting',
            message: 'Đang khởi động ComfyUI...',
            instanceId,
            ip,
            port,
            healthOk: false,
          };
        }
        return {
          status: 'disconnected',
          message: 'Mất kết nối',
          instanceId,
          ip,
          port,
          healthOk: false,
        };
      }
    }

    if (health?.healthy) {
      return {
        status: 'running',
        message: 'ComfyUI sẵn sàng',
        instanceId,
        ip,
        port,
        healthOk: true,
      };
    }

    if (code === 'running' && ip && port != null) {
      return {
        status: 'starting',
        message: 'Đang khởi động ComfyUI...',
        instanceId,
        ip,
        port,
        healthOk: false,
      };
    }

    return {
      status: 'starting',
      message: 'Đang khởi động ComfyUI...',
      instanceId,
      ip,
      port,
      healthOk: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/network|timeout|ECONN/i.test(message)) {
      if (isMachineBooting(machine)) {
        return {
          status: 'starting',
          message: 'Đang khởi động ComfyUI...',
          instanceId,
          ip: machineEndpoint.ip,
          port: machineEndpoint.port,
          healthOk: false,
        };
      }
      return {
        status: 'disconnected',
        message: 'Mất kết nối',
        instanceId,
        ip: machineEndpoint.ip,
        port: machineEndpoint.port,
        healthOk: false,
      };
    }

    return {
      status: 'error',
      message: message || 'Không lấy được trạng thái máy',
      instanceId,
      ip: machineEndpoint.ip,
      port: machineEndpoint.port,
      healthOk: false,
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
export async function markMachineDestroyedLocal(supabaseAdmin, machine) {
  await supabaseAdmin
    .from('machines')
    .update({
      status: 'destroyed',
      stopped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', machine.id);
}

export async function fetchActiveSubscription(supabaseAdmin, userId) {
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
