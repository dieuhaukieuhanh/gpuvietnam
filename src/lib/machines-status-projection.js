/**
 * SCB 2.1 AF v2 — machines/status read handler (projection-only, no Provider I/O).
 * Response is infra-only: no session billing fields (see DASHBOARD_VIEW_CONTRACT).
 */

import {
  getBillingStatus,
  readRemainingForMachine,
  syncMachineIdleState,
  checkAutoStop,
  IDLE_STOP_MINUTES,
} from '@/lib/gpu';
import { isOutOfCredit, REMAINING_STATE_OK } from '@/lib/gpu/remaining-time';
import { buildConsumerEndpoint, isEndpointReadyForTraffic } from '@/lib/endpoint-utils';
import {
  fetchActiveSubscription,
  getActiveMachineForUser,
  getBillableSessionMachineForUser,
} from '@/lib/machines';
import { RUNTIME_REPLACE_UX_MESSAGE } from '@/lib/gpu/runtime-auto-replace-core';
import { enqueueRuntimeAutoReplace } from '@/lib/infrastructure/enqueue-runtime-auto-replace';
import { fetchLiveMetrics } from '@/lib/gpu/metrics';
import { runReadPathProjectionFirst } from '@/lib/machines-drift-projection';
import { toSyncShape } from '@/lib/machines-drift-core';
import { resolveProjectionMachineStatus } from '@/lib/scb-read-path';
import { redactComfyUpstreamForClient, isComfyProxyEnabled } from '@/lib/comfy-proxy';
import { scrubMachineForCustomer } from '@/lib/machines-public';

function scbDbg(label, payload) {
  console.log('[SCB-DBG][api/status/projection]', label, JSON.stringify(payload));
}

/**
 * @param {import('next').NextApiRequest} req
 * @param {import('next').NextApiResponse} res
 * @param {{ user: { id: string }; supabaseAdmin: import('@supabase/supabase-js').SupabaseClient; correlationId: string; scbReqId: string }} ctx
 */
export async function handleMachinesStatusProjectionFirst(req, res, ctx) {
  const { user, supabaseAdmin, correlationId, scbReqId } = ctx;

  const sync = toSyncShape(
    await runReadPathProjectionFirst(supabaseAdmin, user.id, {
      correlationId,
      source: 'machines_status_sync',
    }),
  );

  scbDbg('sync', {
    id: scbReqId,
    userId: user.id,
    changed: sync.changed,
    action: sync.action ?? null,
    hasMachine: Boolean(sync.machine),
  });

  let machine = sync.machine ?? (await getActiveMachineForUser(supabaseAdmin, user.id));
  // Runtime DEAD keep-open: error machine is not in ACTIVE statuses.
  if (!machine || String(machine.status ?? '') === 'destroyed') {
    machine = (await getBillableSessionMachineForUser(supabaseAdmin, user.id)) ?? machine;
  }

  if (sync.changed && !machine) {
    const subscription =
      sync.subscription ?? (await fetchActiveSubscription(supabaseAdmin, user.id));
    if (subscription?.server_status === 'provisioning') {
      const payload = {
        status: 'creating',
        message: 'Đang khởi tạo máy...',
        machineId: null,
        instanceId: null,
        projectionFirst: true,
        reconciled: sync.action ?? null,
      };
      scbDbg('EXIT provisioning-drift-no-machine', { id: scbReqId, payload });
      return res.status(200).json(payload);
    }
    const payload = {
      status: 'offline',
      message: 'Máy chưa bật',
      reconciled: sync.action ?? null,
    };
    scbDbg('EXIT offline-after-sync', { id: scbReqId, payload });
    return res.status(200).json(payload);
  }

  if (!machine) {
    const subscription =
      sync.subscription ?? (await fetchActiveSubscription(supabaseAdmin, user.id));
    if (subscription?.server_status === 'provisioning') {
      // Terminal failed boot left claim stuck (error machine is not "active").
      const { clearStuckProvisioningAfterFailedBoot } = await import('@/lib/machines');
      const cleared = await clearStuckProvisioningAfterFailedBoot(supabaseAdmin, user.id, {
        subscription,
      });
      if (cleared.cleared) {
        const payload = {
          status: 'offline',
          message: 'Máy chưa bật',
          reconciled: cleared.action ?? 'clear_stuck_provisioning_after_failed_boot',
        };
        scbDbg('EXIT offline-after-failed-boot-claim-clear', { id: scbReqId, payload });
        return res.status(200).json(payload);
      }
      const payload = {
        status: 'creating',
        message: 'Đang khởi tạo máy...',
        machineId: null,
        instanceId: null,
        projectionFirst: true,
      };
      scbDbg('EXIT provisioning-no-machine', { id: scbReqId, payload });
      return res.status(200).json(payload);
    }
    const payload = { status: 'offline', message: 'Máy chưa bật' };
    scbDbg('EXIT offline-no-machine', { id: scbReqId, payload });
    return res.status(200).json(payload);
  }

  const subscription =
    sync.subscription ?? (await fetchActiveSubscription(supabaseAdmin, user.id));
  const liveStatus = resolveProjectionMachineStatus(machine, subscription);
  const healthOk = liveStatus.healthOk === true;
  const consumerEndpoint = buildConsumerEndpoint(machine, healthOk);
  const { ip, port, comfyUrl } = consumerEndpoint;

  // Open billable + Runtime DEAD → reconnect/replace UX (never fake idle autostop).
  if (
    liveStatus.status === 'error' ||
    (String(machine.status ?? '') === 'error' && Boolean(machine.billing_started_at))
  ) {
    const sessionId = machine.gpu_session_id ? String(machine.gpu_session_id) : '';
    const subscriptionId = String(machine.subscription_id ?? subscription?.id ?? '');
    if (sessionId && subscriptionId) {
      try {
        await enqueueRuntimeAutoReplace(supabaseAdmin, {
          userId: user.id,
          sessionId,
          oldMachineId: String(machine.id),
          subscriptionId,
          planKey: String(subscription?.plan_key || subscription?.plan || 'pro').toLowerCase(),
          planName: String(subscription?.plan || 'Pro'),
          gpuLine: String(machine.gpu_line || machine.gpu_type || 'rtx_4090'),
          envName: String(subscription?.env_name || machine.template || 'ComfyUI'),
          billingStartedAt: String(machine.billing_started_at || ''),
          provider: machine.provider != null ? String(machine.provider) : null,
          correlationId,
        });
      } catch (enqueueErr) {
        console.warn(
          '[machines-status-projection] enqueue runtime_auto_replace failed:',
          enqueueErr instanceof Error ? enqueueErr.message : enqueueErr,
        );
      }
    }
    const payload = {
      status: 'disconnected',
      message: RUNTIME_REPLACE_UX_MESSAGE,
      machineId: machine.id,
      instanceId: machine.instance_id ? String(machine.instance_id) : null,
      projectionFirst: true,
      runtimeReplace: true,
    };
    scbDbg('EXIT runtime-dead-keep-open', { id: scbReqId, payload });
    return res.status(200).json(payload);
  }

  const activeMachine = machine;
  const isTrafficReady = liveStatus.status === 'running' && healthOk;

  let billing = null;
  let remainingRead = null;

  if (isTrafficReady) {
    billing = await getBillingStatus(supabaseAdmin, user.id, activeMachine);
    remainingRead = await readRemainingForMachine(supabaseAdmin, user.id, activeMachine);
  }

  const outOfHours =
    isTrafficReady &&
    Boolean(activeMachine?.billing_started_at) &&
    remainingRead?.remaining?.state === REMAINING_STATE_OK &&
    isOutOfCredit({
      ...remainingRead.remaining,
      walletBalance: remainingRead.walletBalance,
    });

  let idleInfo = {
    idleMinutes: null,
    lastActivity: null,
    minutesUntilAutoStop: null,
    idleWarningActive: false,
  };

  if (isTrafficReady && activeMachine) {
    idleInfo = await syncMachineIdleState(supabaseAdmin, activeMachine, { healthOk });

    if (outOfHours || (idleInfo.idleMinutes != null && idleInfo.idleMinutes >= IDLE_STOP_MINUTES)) {
      await checkAutoStop(supabaseAdmin, String(activeMachine.id));
      const stillActive = await getActiveMachineForUser(supabaseAdmin, user.id);
      if (!stillActive) {
        const payload = {
          status: 'offline',
          message: outOfHours ? 'Máy đã tắt vì hết giờ' : 'Máy đã tắt do không sử dụng',
        };
        scbDbg('EXIT offline-autostop', { id: scbReqId, payload, outOfHours });
        return res.status(200).json(payload);
      }
    }
  }

  let metrics = null;
  if (isTrafficReady && isEndpointReadyForTraffic(activeMachine, healthOk)) {
    metrics = await fetchLiveMetrics({
      machine: activeMachine,
      healthOk,
      instanceId: liveStatus.instanceId,
      sessionStartedAt: billing?.billingStartedAt ?? activeMachine?.billing_started_at,
    });
  }

  const responsePayload = scrubMachineForCustomer(
    redactComfyUpstreamForClient({
      status: isTrafficReady ? 'running' : liveStatus.status === 'running' ? 'starting' : liveStatus.status,
      machineId: liveStatus.status === 'offline' ? null : activeMachine?.id ?? null,
      instanceId: liveStatus.instanceId,
      ip,
      port,
      comfyUrl,
      message: liveStatus.message ?? null,
      template: activeMachine?.template ? String(activeMachine.template) : null,
      projectionFirst: true,
      metrics,
      idleMinutes: idleInfo.idleMinutes,
      lastActivity: idleInfo.lastActivity,
      minutesUntilAutoStop: idleInfo.minutesUntilAutoStop,
      idleWarningActive: idleInfo.idleWarningActive,
      comfyProxyEnabled: isComfyProxyEnabled(),
    }),
  );

  scbDbg('EXIT ok', { id: scbReqId, status: responsePayload.status });
  return res.status(200).json(responsePayload);
}
