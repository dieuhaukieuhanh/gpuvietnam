import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import {
  getGpuService,
  getBillingStatus,
  readRemainingForMachine,
  openBillableSession,
  loadActiveSessionRow,
  fetchLiveMetrics,
  syncMachineIdleState,
  checkAutoStop,
  IDLE_STOP_MINUTES,
} from '@/lib/gpu';
import { isOutOfCredit, REMAINING_STATE_OK } from '@/lib/gpu/remaining-time';
import {
  mapRemainingStatusFields,
  mapSessionStatusFields,
} from '@/lib/gpu/api-scb';
import {
  extractEndpointFromMachine,
  getActiveMachineForUser,
  syncSubscriptionWithMachineState,
  resolveLiveMachineStatus,
  syncMachineFromLiveStatus,
  updateSubscriptionServerStatus,
  destroyUserMachine,
} from '@/lib/machines';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function scbDbg(label, payload) {
  console.log('[SCB-DBG][api/status]', label, JSON.stringify(payload));
}

export default async function handler(req, res) {
  const scbReqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  scbDbg('ENTER', { id: scbReqId, ts: new Date().toISOString(), method: req.method });
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) {
      scbDbg('EXIT unauthorized', { id: scbReqId });
      return unauthorized(res);
    }

    const supabaseAdmin = getSupabaseAdmin();
    const gpuService = getGpuService();
    const sync = await syncSubscriptionWithMachineState(supabaseAdmin, gpuService, user.id);
    scbDbg('sync', {
      id: scbReqId,
      userId: user.id,
      changed: sync.changed,
      action: sync.action ?? null,
      hasMachine: Boolean(sync.machine),
      machineId: sync.machine?.id ?? null,
      machineServerStatus: sync.machine?.subscription_id ? 'present' : null,
    });

    if (sync.changed && !sync.machine) {
      const payload = {
        status: 'offline',
        message: 'Máy chưa bật',
        reconciled: sync.action ?? null,
      };
      scbDbg('EXIT offline-after-sync', { id: scbReqId, payload });
      return res.status(200).json(payload);
    }

    let machine = sync.machine ?? (await getActiveMachineForUser(supabaseAdmin, user.id));

    if (!machine) {
      const payload = { status: 'offline', message: 'Máy chưa bật' };
      scbDbg('EXIT offline-no-machine', { id: scbReqId, payload });
      return res.status(200).json(payload);
    }

    scbDbg('machine-loaded', {
      id: scbReqId,
      machineId: machine.id,
      instanceId: machine.instance_id,
      gpuSessionId: machine.gpu_session_id,
      subscriptionId: machine.subscription_id,
      billingStartedAt: machine.billing_started_at,
    });

    const liveStatus = await resolveLiveMachineStatus(gpuService, machine);
    scbDbg('liveStatus', {
      id: scbReqId,
      status: liveStatus.status,
      instanceId: liveStatus.instanceId,
      ip: liveStatus.ip,
      port: liveStatus.port,
      message: liveStatus.message ?? null,
    });

    if (liveStatus.status === 'error') {
      await destroyUserMachine(supabaseAdmin, gpuService, user.id, {
        skipBackup: true,
        interrupted: true,
        skipBilling: true,
        reason: 'provision_failed',
      });
      if (machine.subscription_id) {
        await updateSubscriptionServerStatus(
          supabaseAdmin,
          String(machine.subscription_id),
          'offline',
        );
      }
      const payload = {
        status: 'error',
        message: liveStatus.message ?? 'Khởi tạo máy thất bại',
      };
      scbDbg('EXIT error', { id: scbReqId, payload });
      return res.status(200).json(payload);
    }

    const synced = await syncMachineFromLiveStatus(supabaseAdmin, machine, liveStatus);

    if (liveStatus.status === 'running') {
      if (machine.subscription_id) {
        await updateSubscriptionServerStatus(supabaseAdmin, String(machine.subscription_id), 'online');
      }

      if (liveStatus.instanceId) {
        try {
          await openBillableSession(
            supabaseAdmin,
            user.id,
            liveStatus.instanceId,
            gpuService,
          );
        } catch (billingError) {
          console.warn('[machines/status] openBillableSession failed (non-fatal):', billingError);
        }
      }

      // Runtime workstation switching disabled (Restart-only architecture).
      // Workflows are applied at container boot via setup-workstation.sh + GPUVIETNAM_* env vars.
    }

    const refreshedMachine = await getActiveMachineForUser(supabaseAdmin, user.id);
    const activeMachine = refreshedMachine ?? synced;

    scbDbg('activeMachine-after-sync', {
      id: scbReqId,
      refreshed: Boolean(refreshedMachine),
      activeMachineId: activeMachine?.id ?? null,
      activeInstanceId: activeMachine?.instance_id ?? null,
      activeGpuSessionId: activeMachine?.gpu_session_id ?? null,
      activeBillingStartedAt: activeMachine?.billing_started_at ?? null,
    });

    const billing = await getBillingStatus(supabaseAdmin, user.id, activeMachine);
    const remainingRead = await readRemainingForMachine(supabaseAdmin, user.id, activeMachine);
    const sessionRow = await loadActiveSessionRow(
      supabaseAdmin,
      activeMachine?.gpu_session_id ? String(activeMachine.gpu_session_id) : null,
      activeMachine?.id ? String(activeMachine.id) : null,
    );
    scbDbg('billing-remaining-session', {
      id: scbReqId,
      billing: {
        sessionDurationSeconds: billing.sessionDurationSeconds,
        billingStartedAt: billing.billingStartedAt,
        hoursRemaining: billing.hoursRemaining,
        effectiveHoursRemaining: billing.effectiveHoursRemaining,
        walletBalance: billing.walletBalance,
        planType: billing.planType,
      },
      remaining: {
        state: remainingRead.remaining?.state ?? null,
        remainingHours: remainingRead.remaining?.remainingHours ?? null,
        totalEntitlementHours: remainingRead.remaining?.totalEntitlementHours ?? null,
        currentSessionElapsedHours: remainingRead.remaining?.currentSessionElapsedHours ?? null,
        settledSessionUsageHours: remainingRead.remaining?.settledSessionUsageHours ?? null,
        walletBalance: remainingRead.walletBalance ?? null,
      },
      sessionRow: sessionRow
        ? {
            id: sessionRow.id,
            status: sessionRow.status,
            settlement_status: sessionRow.settlement_status,
            verified_running_at: sessionRow.verified_running_at,
            verified_destroyed_at: sessionRow.verified_destroyed_at,
          }
        : null,
    });
    const remainingFields = mapRemainingStatusFields(remainingRead);
    const sessionFields = mapSessionStatusFields(sessionRow);
    const endpoint = extractEndpointFromMachine(activeMachine);
    const ip = liveStatus.ip ?? endpoint.ip;
    const port = liveStatus.port ?? endpoint.port;

    let metrics = null;
    if (liveStatus.status === 'running' && ip) {
      metrics = await fetchLiveMetrics({
        ip,
        port,
        instanceId: liveStatus.instanceId,
        sessionStartedAt: billing.billingStartedAt ?? activeMachine?.billing_started_at,
      });
    }

    const outOfHours =
      liveStatus.status === 'running' &&
      remainingRead.remaining?.state === REMAINING_STATE_OK &&
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

    if (liveStatus.status === 'running' && activeMachine) {
      idleInfo = await syncMachineIdleState(supabaseAdmin, activeMachine);

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

    const lowCreditWarning =
      liveStatus.status === 'running' &&
      billing.effectiveHoursRemaining != null &&
      billing.effectiveHoursRemaining > 0 &&
      billing.effectiveHoursRemaining <= 0.08;

    const billingPayload =
      liveStatus.status === 'running'
        ? {
            sessionDurationSeconds: billing.sessionDurationSeconds,
            billingStartedAt: billing.billingStartedAt,
            hoursRemaining: billing.hoursRemaining,
            effectiveHoursRemaining: billing.effectiveHoursRemaining,
            walletBalance: billing.walletBalance,
            planType: billing.planType,
            outOfHours,
            lowCreditWarning,
          }
        : {
            sessionDurationSeconds: 0,
            billingStartedAt: null,
            hoursRemaining: null,
            effectiveHoursRemaining: null,
            walletBalance: null,
            planType: null,
            outOfHours: false,
            lowCreditWarning: false,
          };

    const responsePayload = {
      status: liveStatus.status,
      machineId: activeMachine?.id ?? null,
      instanceId: liveStatus.instanceId,
      ip,
      port,
      comfyUrl: liveStatus.comfyUrl ?? endpoint.comfyUrl,
      message: liveStatus.message ?? null,
      ...billingPayload,
      ...remainingFields,
      ...sessionFields,
      idleMinutes: idleInfo.idleMinutes,
      lastActivity: idleInfo.lastActivity,
      minutesUntilAutoStop: idleInfo.minutesUntilAutoStop,
      idleWarningActive: idleInfo.idleWarningActive,
      metrics,
    };

    scbDbg('EXIT ok', {
      id: scbReqId,
      payload: {
        status: responsePayload.status,
        machineId: responsePayload.machineId,
        instanceId: responsePayload.instanceId,
        sessionDurationSeconds: responsePayload.sessionDurationSeconds,
        billingStartedAt: responsePayload.billingStartedAt,
        remainingHours: responsePayload.remainingHours,
        totalEntitlementHours: responsePayload.totalEntitlementHours,
        sessionStatus: responsePayload.sessionStatus,
        settlementStatus: responsePayload.settlementStatus,
        verifiedRunningAt: responsePayload.verifiedRunningAt,
        outOfHours: responsePayload.outOfHours,
        idleMinutes: responsePayload.idleMinutes,
      },
    });

    return res.status(200).json(responsePayload);
  } catch (err) {
    console.error('[SCB-DBG][api/status] EXIT error-throw', err instanceof Error ? err.message : String(err));
    console.error('❌ message:', err instanceof Error ? err.message : String(err));
    console.error('❌ stack:', err instanceof Error ? err.stack : '(no stack)');
    console.error('[machines/status]', err);
    return res.status(500).json({ error: err.message || 'Không lấy được trạng thái máy.' });
  }
}
