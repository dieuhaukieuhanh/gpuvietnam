/**
 * Session Resume service — load authoritative state and build restore payload.
 * Read-only: never claims a lease or creates a provider order.
 */

import { getGpuService, getGpuServiceForMachine } from '@/lib/gpu/gpu-service.js';
import { snapshotToMachineRecord, resolveMachineSessionView } from '@/lib/gpu/machine-session-view.js';
import { resolveBillingViewForCommand } from '@/lib/gpu/billing-session-view.js';
import { buildConsumerEndpoint } from '@/lib/endpoint-utils.js';
import {
  getActiveMachineForUser,
  resolveLiveMachineStatus,
  syncMachineFromLiveStatus,
} from '@/lib/machines.js';
import { isProvisionLeaseExpired } from '@/lib/provision-lease.js';
import { decideSessionResume } from './session-resume-core.js';
import { RESUME_STATE } from './session-resume-states.js';
import { logSessionResumeEvent } from './session-resume-log.js';
import {
  incrSessionResumeMetric,
  recordResumeDurationMs,
} from './session-resume-metrics.js';
import { getProvisionProgress } from '@/lib/provision-progress/index.js';

const ACTIVE_SUB_STATUSES = ['active', 'provisioning'];

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
async function loadActiveSubscription(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select(
      'id, status, server_status, provisioning_started_at, provisioning_lease_id, provisioning_lease_expires_at, provisioning_heartbeat_at, provisioning_lease_owner, env_name, billing, plan, gpu_label',
    )
    .eq('user_id', userId)
    .in('status', ACTIVE_SUB_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {string | null} machineId
 */
async function loadLatestGpuSession(supabaseAdmin, userId, machineId) {
  if (machineId) {
    const { data, error } = await supabaseAdmin
      .from('gpu_sessions')
      .select('id, status, settlement_status, machine_id, started_at, created_at')
      .eq('user_id', userId)
      .eq('machine_id', String(machineId))
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  const { data, error } = await supabaseAdmin
    .from('gpu_sessions')
    .select('id, status, settlement_status, machine_id, started_at, created_at')
    .eq('user_id', userId)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * @param {Record<string, unknown> | null | undefined} machine
 * @param {{ status?: string; healthOk?: boolean; ip?: string|null; port?: number|null } | null} liveStatus
 */
function buildEndpointPayload(machine, liveStatus) {
  const healthOk = liveStatus?.healthOk === true;
  const endpoint = buildConsumerEndpoint(machine, healthOk);
  return {
    ip: endpoint.ip ?? liveStatus?.ip ?? null,
    port: endpoint.port ?? liveStatus?.port ?? null,
    comfyUrl: endpoint.comfyUrl ?? null,
  };
}

/**
 * Build full session resume snapshot for dashboard restore / safe start.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{
 *   requestId?: string | null;
 *   skipLiveStatus?: boolean;
 *   source?: string;
 * }} [options]
 */
export async function buildSessionResumeSnapshot(supabaseAdmin, userId, options = {}) {
  const started = Date.now();
  const requestId = options.requestId ?? null;
  incrSessionResumeMetric('resumeAttempts');

  logSessionResumeEvent(
    'SESSION_RESUME_REQUEST',
    { requestId, userId, source: options.source ?? 'api' },
    'Session resume requested',
  );

  try {
    const subscription = await loadActiveSubscription(supabaseAdmin, userId);
    let machine = await getActiveMachineForUser(supabaseAdmin, userId);
    let gpuService = machine ? getGpuServiceForMachine(machine) : getGpuService();

    /** @type {{ status?: string; healthOk?: boolean; message?: string|null; ip?: string|null; port?: number|null; instanceId?: string|null } | null} */
    let liveStatus = null;
    if (machine && !options.skipLiveStatus) {
      try {
        liveStatus = await resolveLiveMachineStatus(gpuService, machine);
        if (liveStatus) {
          machine = await syncMachineFromLiveStatus(supabaseAdmin, machine, liveStatus);
        }
      } catch (error) {
        logSessionResumeEvent(
          'SESSION_RESUME_FAILED',
          {
            requestId,
            userId,
            machineId: machine?.id ?? null,
            reason: 'live_status_error',
            err: error instanceof Error ? error.message : String(error),
          },
          'Live status failed during resume (continuing with DB projection)',
        );
      }
    }

    const sessionRow = await loadLatestGpuSession(
      supabaseAdmin,
      userId,
      machine?.id != null ? String(machine.id) : null,
    );

    const serverStatus = subscription?.server_status ?? 'offline';
    const leaseExpired = subscription ? isProvisionLeaseExpired(subscription) : true;
    const hasActiveLease =
      String(serverStatus) === 'provisioning' &&
      !leaseExpired &&
      Boolean(subscription?.provisioning_lease_id || subscription?.provisioning_started_at);

    const decision = decideSessionResume({
      serverStatus,
      leaseExpired,
      hasActiveLease,
      machine,
      liveStatus: liveStatus?.status ?? null,
      healthOk: liveStatus?.healthOk === true,
      sessionStatus: sessionRow?.status ?? null,
      machineLifecycleStatus: machine?.status ?? null,
    });

    const record = snapshotToMachineRecord(subscription, machine, userId);
    const endpoint = buildEndpointPayload(machine, liveStatus);
    const machineSessionView = resolveMachineSessionView(record, {
      envName: subscription?.env_name ?? null,
      comfyUrl: endpoint.comfyUrl,
      disconnected: liveStatus?.status === 'disconnected',
    });

    const billingView = await resolveBillingViewForCommand(supabaseAdmin, userId, {
      machineSessionView,
      machine: machine ?? null,
      gpuService,
    });

    const resumeDurationMs = Date.now() - started;
    recordResumeDurationMs(resumeDurationMs);

    const progress = subscription?.id
      ? await getProvisionProgress(String(subscription.id), {
          supabaseAdmin,
          resumeState: decision.shouldResume ? decision.currentState : null,
        })
      : null;

    if (decision.shouldResume) {
      incrSessionResumeMetric('resumeSuccess');
      if (decision.duplicateStartPrevented) {
        incrSessionResumeMetric('duplicateStartPrevented');
      }
      logSessionResumeEvent(
        decision.currentState === RESUME_STATE.RUNNING
          ? 'SESSION_ALREADY_RUNNING'
          : 'SESSION_RESUME_FOUND',
        {
          requestId,
          userId,
          machineId: machine?.id ?? machine?.instance_id ?? null,
          gpuSessionId: sessionRow?.id ?? null,
          provider: machine?.provider ?? null,
          currentState: decision.currentState,
          reason: decision.reason,
          resumeDurationMs,
        },
        'Resumable session found',
      );
      logSessionResumeEvent(
        'SESSION_RESUME_RESTORED',
        {
          requestId,
          userId,
          machineId: machine?.id ?? machine?.instance_id ?? null,
          gpuSessionId: sessionRow?.id ?? null,
          provider: machine?.provider ?? null,
          currentState: decision.currentState,
          progressStep: decision.progressStep,
          resumeDurationMs,
        },
        'Session resume payload restored',
      );
    } else {
      logSessionResumeEvent(
        'SESSION_RESUME_FOUND',
        {
          requestId,
          userId,
          currentState: decision.currentState,
          reason: decision.reason,
          resumeDurationMs,
        },
        'No resumable session — new provision allowed',
      );
    }

    return {
      success: true,
      shouldResume: decision.shouldResume,
      allowNewProvision: decision.allowNewProvision,
      duplicateStartPrevented: decision.duplicateStartPrevented,
      currentState: decision.currentState,
      progressStep: decision.progressStep,
      reason: decision.reason,
      requestId,
      machineId: machine?.id != null ? String(machine.id) : null,
      instanceId: machine?.instance_id != null ? String(machine.instance_id) : null,
      gpuSessionId: sessionRow?.id != null ? String(sessionRow.id) : null,
      provider: machine?.provider != null ? String(machine.provider) : null,
      gpuType: machine?.gpu_type ?? machine?.gpu_line ?? subscription?.gpu_label ?? null,
      subscriptionId: subscription?.id != null ? String(subscription.id) : null,
      serverStatus,
      lease: subscription
        ? {
            leaseId: subscription.provisioning_lease_id ?? null,
            expiresAt: subscription.provisioning_lease_expires_at ?? null,
            heartbeatAt: subscription.provisioning_heartbeat_at ?? null,
            owner: subscription.provisioning_lease_owner ?? null,
            startedAt: subscription.provisioning_started_at ?? null,
            expired: leaseExpired,
            active: hasActiveLease,
          }
        : null,
      estimatedRemainingTime: billingView?.remainingHours ?? null,
      comfyStatus: liveStatus?.healthOk
        ? 'healthy'
        : liveStatus?.status === 'running'
          ? 'healthy'
          : liveStatus?.status === 'starting' || liveStatus?.status === 'creating'
            ? 'starting'
            : liveStatus?.status === 'disconnected'
              ? 'disconnected'
              : decision.currentState === RESUME_STATE.OFFLINE
                ? 'offline'
                : 'unknown',
      endpoint,
      message: machineSessionView?.message ?? liveStatus?.message ?? null,
      machineSessionView,
      billingView,
      progress,
      resumeDurationMs,
    };
  } catch (error) {
    incrSessionResumeMetric('resumeFailures');
    const resumeDurationMs = Date.now() - started;
    recordResumeDurationMs(resumeDurationMs);
    logSessionResumeEvent(
      'SESSION_RESUME_FAILED',
      {
        requestId,
        userId,
        resumeDurationMs,
        err: error instanceof Error ? error.message : String(error),
      },
      'Session resume failed',
    );
    throw error;
  }
}

/**
 * Lightweight decision for start-machine early exit (uses already-loaded rows).
 *
 * @param {{
 *   subscription: Record<string, unknown> | null | undefined;
 *   machine: Record<string, unknown> | null | undefined;
 *   liveStatus?: { status?: string; healthOk?: boolean } | null;
 *   sessionStatus?: string | null;
 * }} input
 */
export function decideResumeFromLoadedState(input) {
  const subscription = input.subscription;
  const serverStatus = subscription?.server_status ?? 'offline';
  const leaseExpired = subscription ? isProvisionLeaseExpired(subscription) : true;
  const hasActiveLease =
    String(serverStatus) === 'provisioning' &&
    !leaseExpired &&
    Boolean(subscription?.provisioning_lease_id || subscription?.provisioning_started_at);

  return decideSessionResume({
    serverStatus: String(serverStatus),
    leaseExpired,
    hasActiveLease,
    machine: input.machine ?? null,
    liveStatus: input.liveStatus?.status ?? null,
    healthOk: input.liveStatus?.healthOk === true,
    sessionStatus: input.sessionStatus ?? null,
    machineLifecycleStatus: input.machine?.status != null ? String(input.machine.status) : null,
  });
}