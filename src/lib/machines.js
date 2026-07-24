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
import { resolveMachineImage } from './machines-image-resolve.js';
import { shouldKeepBillingSessionOpenOnRuntimeDead } from './gpu/billing-session-p0b.js';
import { enqueueRuntimeAutoReplace } from './infrastructure/enqueue-runtime-auto-replace.js';
import {
  RUNTIME_REPLACE_UX_MESSAGE,
  loadOpenBillableSessionForUser,
} from './gpu/runtime-auto-replace-core.js';

export {
  claimSubscriptionForProvision,
  reclaimStaleProvisionClaim,
  buildProvisionAttemptLabel,
} from './machines-provision-claim.js';

export { resolveMachineImage } from './machines-image-resolve.js';

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
 * Machine bound to an OPEN billable session — includes `error` during Runtime DEAD /
 * auto-replace (not in ACTIVE_MACHINE_STATUSES, but billing must keep counting).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function getBillableSessionMachineForUser(supabaseAdmin, userId) {
  const active = await getActiveMachineForUser(supabaseAdmin, userId);
  if (active) return active;

  const openSession = await loadOpenBillableSessionForUser(supabaseAdmin, userId);
  if (!openSession) return null;

  if (openSession.machine_id) {
    const { data: byId, error } = await supabaseAdmin
      .from('machines')
      .select('*')
      .eq('id', String(openSession.machine_id))
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (byId && String(byId.status ?? '') !== 'destroyed') return byId;
  }

  const { data: bySession, error: bySessErr } = await supabaseAdmin
    .from('machines')
    .select('*')
    .eq('user_id', userId)
    .eq('gpu_session_id', String(openSession.id))
    .neq('status', 'destroyed')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (bySessErr) throw bySessErr;
  return bySession;
}

/**
 * All non-destroyed machines still bootstrapping or running for a user.
 * Used to block multi-start (except CP dual-run / Render an toàn).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function listActiveMachinesForUser(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('machines')
    .select('*')
    .eq('user_id', userId)
    .in('status', ACTIVE_MACHINE_STATUSES)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/**
 * @param {Record<string, unknown> | null | undefined} machine
 */
export function extractEndpointFromMachine(machine) {
  return buildEndpointFromMachine(machine);
}

/**
 * @param {import('./gpu/domain/gpu-instance').GPUInstance} instance
 * @param {{ gpuLine: string; region?: string; subscriptionId?: string; template?: string; image?: string | null }} context
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
    provider: instance.providerId ?? 'clore',
    ip_address: endpoint.ip,
    port,
    status,
    gpu_type: context.gpuLine,
    gpu_line: context.gpuLine,
    region: instance.region ?? context.region ?? null,
    subscription_id: context.subscriptionId ?? null,
    template: context.template ?? null,
    image: resolveMachineImage(instance, context),
    error_message: status === 'error' ? instance.status?.message ?? 'GPU failed' : null,
    ssh_password:
      typeof instance.metadata?.sshPassword === 'string' && instance.metadata.sshPassword
        ? instance.metadata.sshPassword
        : String(process.env.CLORE_SSH_PASSWORD ?? '').trim() || null,
    ssh_ok:
      typeof instance.metadata?.sshOk === 'boolean' ? instance.metadata.sshOk : null,
    ops_degraded: instance.metadata?.opsDegraded === true,
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
  const payload = {
    user_id: userId,
    ...row,
    updated_at: new Date().toISOString(),
  };

  let { data, error } = await supabaseAdmin.from('machines').insert(payload).select('*').single();

  // Soft-fail if optional columns not migrated yet.
  if (error && /ssh_password|backup_flush_secret|image|ssh_ok|ops_degraded/i.test(error.message || '')) {
    /** @type {Record<string, unknown>} */
    let next = { ...payload };
    if (/ssh_password/i.test(error.message || '') && 'ssh_password' in next) {
      const { ssh_password: _omit, ...rest } = next;
      next = rest;
    }
    if (/backup_flush_secret/i.test(error.message || '') && 'backup_flush_secret' in next) {
      const { backup_flush_secret: _omit2, ...rest2 } = next;
      next = rest2;
    }
    if (/image/i.test(error.message || '') && 'image' in next) {
      const { image: _omit3, ...rest3 } = next;
      next = rest3;
    }
    if (/ssh_ok|ops_degraded/i.test(error.message || '')) {
      const { ssh_ok: _omit4, ops_degraded: _omit5, ...restOps } = next;
      next = restOps;
    }
    ({ data, error } = await supabaseAdmin.from('machines').insert(next).select('*').single());
  }

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
      if (/network|timeout|ECONN|proxy is starting/i.test(message)) {
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
        message: 'Generate đã sẵn sàng',
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
  const { clearedProvisionLeaseFields } = await import('./provision-lease.js');
  /** @type {Record<string, unknown>} */
  const patch = { server_status: serverStatus };
  if (serverStatus !== 'provisioning') {
    Object.assign(patch, clearedProvisionLeaseFields());
  }

  const { error } = await supabaseAdmin
    .from('subscriptions')
    .update(patch)
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
  const [{ data: rows, error }, machine] = await Promise.all([
    supabaseAdmin
      .from('subscriptions')
      .select('id, server_status, status, created_at')
      .eq('user_id', userId)
      .in('status', ['active', 'provisioning'])
      .order('created_at', { ascending: false })
      .limit(20),
    getActiveMachineForUser(supabaseAdmin, userId),
  ]);

  if (error) throw error;
  return pickPreferredActiveSubscription(rows ?? [], machine);
}

/**
 * Prefer the subscription that owns the live machine / is online.
 * Newest-created alone is wrong after hour top-up (new offline row hides the session).
 *
 * @param {Record<string, unknown>[] | null | undefined} subscriptions
 * @param {Record<string, unknown> | null | undefined} machine
 */
export function pickPreferredActiveSubscription(subscriptions, machine = null) {
  const list = Array.isArray(subscriptions) ? subscriptions.filter(Boolean) : [];
  if (list.length === 0) return null;

  const machineSubId =
    machine?.subscription_id != null ? String(machine.subscription_id) : null;
  if (machineSubId) {
    const matched = list.find((row) => String(row.id) === machineSubId);
    if (matched) return matched;
  }

  const online = list.find((row) => String(row.server_status ?? '') === 'online');
  if (online) return online;

  const provisioning = list.find(
    (row) => String(row.server_status ?? '') === 'provisioning',
  );
  if (provisioning) return provisioning;

  return list[0];
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
 * Clear provisioning claim when the latest boot already failed (machine error/destroyed)
 * and there is no active machine. Safe for read path — does not clear mid-boot
 * before a machine row exists.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{ subscription?: Record<string, unknown>|null }} [options]
 */
export async function clearStuckProvisioningAfterFailedBoot(supabaseAdmin, userId, options = {}) {
  const active = await getActiveMachineForUser(supabaseAdmin, userId);
  if (active) {
    return { cleared: false, reason: 'active_machine_exists' };
  }

  // Never clear while durable Start is still leased/running — Clore may already
  // be rented before the machines row exists; wiping the claim drops UI to idle.
  const { data: activeStart, error: opErr } = await supabaseAdmin
    .from('machine_operations')
    .select('id,state')
    .eq('user_id', userId)
    .eq('operation', 'user_start_provision')
    .in('state', ['pending', 'leased', 'running', 'retry_scheduled'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (opErr) throw opErr;
  if (activeStart) {
    return { cleared: false, reason: 'start_op_in_flight', operationId: String(activeStart.id) };
  }

  const subscription =
    options.subscription ?? (await fetchActiveSubscription(supabaseAdmin, userId));
  if (!subscription || String(subscription.server_status ?? '') !== 'provisioning') {
    return { cleared: false, reason: 'not_provisioning' };
  }

  const provisioningStartedAt = subscription.provisioning_started_at
    ? new Date(String(subscription.provisioning_started_at)).getTime()
    : 0;
  // Missing started_at: do not guess from an older destroyed row.
  if (!Number.isFinite(provisioningStartedAt) || provisioningStartedAt <= 0) {
    return { cleared: false, reason: 'missing_provisioning_started_at' };
  }

  const { data: latest, error } = await supabaseAdmin
    .from('machines')
    .select('id,status,created_at,subscription_id,error_message')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!latest) {
    return { cleared: false, reason: 'no_machine_row_yet' };
  }

  const latestStatus = String(latest.status ?? '');
  if (latestStatus !== 'error' && latestStatus !== 'destroyed') {
    return { cleared: false, reason: 'latest_not_terminal' };
  }

  const latestCreated = latest.created_at ? new Date(String(latest.created_at)).getTime() : 0;
  if (latestCreated + 1000 < provisioningStartedAt) {
    return { cleared: false, reason: 'latest_before_claim' };
  }

  await updateSubscriptionServerStatus(supabaseAdmin, String(subscription.id), 'offline');
  return {
    cleared: true,
    action: 'clear_stuck_provisioning_after_failed_boot',
    subscriptionId: String(subscription.id),
    machineId: String(latest.id),
  };
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
    // P0-B / P1: Billing Session OPEN (or replace in flight) — do not flip offline.
    const openBillable = await loadOpenBillableSessionForUser(supabaseAdmin, userId);
    if (openBillable && subscription.server_status === 'online') {
      return {
        changed: false,
        machine: null,
        subscription,
        action: 'keep_online_open_session_no_active_machine',
      };
    }

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

        // P0-B: Runtime DEAD must NOT settle / close Billing Session.
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

          // P1: enqueue auto-replace (durable worker). Never settle.
          try {
            const planKey = String(
              subscription.plan_key || subscription.plan || openSession.plan || 'pro',
            ).toLowerCase();
            const gpuLine = String(
              machine.gpu_line || machine.gpu_type || subscription.gpu_line || 'rtx_4090',
            );
            await enqueueRuntimeAutoReplace(supabaseAdmin, {
              userId,
              sessionId: String(openSession.id),
              oldMachineId: String(machine.id),
              subscriptionId: String(subscription.id),
              planKey,
              planName: String(subscription.plan || openSession.plan || 'Pro'),
              gpuLine,
              envName: String(subscription.env_name || openSession.template || 'ComfyUI'),
              billingStartedAt: String(
                machine.billing_started_at || openSession.started_at,
              ),
              provider: machine.provider != null ? String(machine.provider) : null,
              session: openSession,
            });
          } catch (enqueueErr) {
            console.warn(
              '[syncSubscriptionWithMachineState] enqueue runtime_auto_replace failed:',
              enqueueErr instanceof Error ? enqueueErr.message : enqueueErr,
            );
          }

          return {
            changed: true,
            machine: { ...machine, status: 'error', projection_message: RUNTIME_REPLACE_UX_MESSAGE },
            subscription,
            action: 'runtime_dead_session_kept_open',
          };
        }

        await destroyUserMachine(supabaseAdmin, gpuService, userId, {
          skipBackup: true,
          interrupted: true,
          reason: 'user_stop',
          skipBilling: !machine.billing_started_at,
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
