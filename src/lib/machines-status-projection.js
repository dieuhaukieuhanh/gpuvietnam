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
} from '@/lib/machines';
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

  if (sync.changed && !sync.machine) {
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

  const machine = sync.machine ?? (await getActiveMachineForUser(supabaseAdmin, user.id));
  if (!machine) {
    const subscription =
      sync.subscription ?? (await fetchActiveSubscription(supabaseAdmin, user.id));
    if (subscription?.server_status === 'provisioning') {
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

  if (liveStatus.status === 'error') {
    const payload = {
      status: 'error',
      message: liveStatus.message ?? 'Khởi tạo máy thất bại',
    };
    scbDbg('EXIT error', { id: scbReqId, payload });
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
