/**
 * P1 — Replace dead Runtime while Billing Session stays OPEN.
 * Never Close/settle. Same gpu_sessions.id + immutable started_at (SCB).
 * Gap dead→new-Comfy-ready is not billable (billing_gap_seconds + clear machine anchor).
 *
 * Order: keep old projection for UX → rent new → rebind session → destroy old →
 * resume billing only when new Comfy is healthy.
 */

import { randomUUID } from 'node:crypto';

import { getGpuLabel } from '@/lib/gpu-pricing';
import {
  getGpuService,
  getGpuServiceForMachine,
  provisionGpuInstance,
} from '@/lib/gpu';
import { rebindComfyProxyToRuntime } from '@/lib/cp-runtime/runtime-rebind.js';
import {
  insertMachineRecord,
  mapGpuInstanceToMachineRow,
  resolveLiveMachineStatus,
  syncMachineFromLiveStatus,
} from '@/lib/machines';
import { buildEndpointFromMachine } from '@/lib/endpoint-utils';
import {
  RUNTIME_REPLACE_UX_MESSAGE,
  accumulateBillingGapSeconds,
  evaluateRuntimeAutoReplaceEligibility,
  loadOpenBillableSessionForUser,
} from './runtime-auto-replace-core.js';

export {
  RUNTIME_REPLACE_UX_MESSAGE,
  accumulateBillingGapSeconds,
  evaluateRuntimeAutoReplaceEligibility,
  loadOpenBillableSessionForUser,
};

const MAX_READY_POLLS = 24;
const READY_POLL_MS = 10_000;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   userId: string;
 *   sessionId: string;
 *   oldMachineId: string;
 *   subscriptionId: string;
 *   planKey: string;
 *   planName: string;
 *   gpuLine: string;
 *   envName: string;
 *   billingStartedAt: string;
 *   correlationId?: string;
 * }} params
 */
export async function completeRuntimeAutoReplace(supabaseAdmin, params) {
  const userId = String(params.userId);
  const sessionId = String(params.sessionId);
  const oldMachineId = String(params.oldMachineId);
  const subscriptionId = String(params.subscriptionId);
  const correlationId = String(params.correlationId || randomUUID());

  const { data: session, error: sessErr } = await supabaseAdmin
    .from('gpu_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessErr) throw sessErr;

  // Skip if session already has another healthy machine (race / prior replace won).
  const { data: healthyPeers } = await supabaseAdmin
    .from('machines')
    .select('id, status')
    .eq('user_id', userId)
    .eq('gpu_session_id', sessionId)
    .in('status', ['creating', 'starting', 'running'])
    .neq('id', oldMachineId)
    .limit(1);

  const eligibility = evaluateRuntimeAutoReplaceEligibility(session, {
    hasHealthyActiveMachineForSession: Array.isArray(healthyPeers) && healthyPeers.length > 0,
  });
  if (!eligibility.allow) {
    return { skipped: true, reason: eligibility.reason };
  }

  const gpuLine = String(params.gpuLine || 'rtx_4090');
  const planKey = String(params.planKey || 'pro');
  const envName = String(params.envName || session.template || 'ComfyUI');

  const { data: oldMachine } = await supabaseAdmin
    .from('machines')
    .select('*')
    .eq('id', oldMachineId)
    .maybeSingle();

  const previousEndpoint = oldMachine ? buildEndpointFromMachine(oldMachine) : null;
  const now = new Date().toISOString();
  /** Gap clock starts when we stop live billing on the dead machine. */
  const gapStartedMs = Date.now();

  // 1) Keep old row visible as Runtime DEAD until the new GPU is bound
  //    (destroy-first made Dashboard lose the interrupt banner).
  //    Clear billing_started_at so live remaining does not burn during the gap.
  if (oldMachine && String(oldMachine.status ?? '') !== 'destroyed') {
    await supabaseAdmin
      .from('machines')
      .update({
        status: 'error',
        updated_at: now,
        billing_started_at: null,
        projection_message: RUNTIME_REPLACE_UX_MESSAGE,
      })
      .eq('id', oldMachineId);
  }

  // 2) Rent new GPU first
  const label = `gvn-replace-${String(userId).slice(0, 8)}-${Date.now()}`;
  const instance = await provisionGpuInstance(getGpuService(), {
    gpuLine,
    plan: planKey,
    label,
    onProgress: () => {},
  });

  const machineRow = mapGpuInstanceToMachineRow(instance, {
    gpuLine,
    subscriptionId,
    region: instance.region ?? null,
  });

  // 3) Insert machine linked to SAME billing session but DON'T anchor billing yet.
  // Billing only resumes when the new GPU is confirmed healthy (step 5).
  const newMachine = await insertMachineRecord(supabaseAdmin, userId, {
    ...machineRow,
    gpu_session_id: sessionId,
    billing_started_at: null,
    projection_message: RUNTIME_REPLACE_UX_MESSAGE,
    template: envName,
  });

  await supabaseAdmin
    .from('gpu_sessions')
    .update({ machine_id: newMachine.id })
    .eq('id', sessionId)
    .eq('status', 'running');

  await supabaseAdmin
    .from('subscriptions')
    .update({ server_status: 'online', updated_at: new Date().toISOString() })
    .eq('id', subscriptionId);

  // 4) Destroy old Runtime (provider + local) — session already rebound.
  if (oldMachine?.instance_id) {
    try {
      const svc = getGpuServiceForMachine(oldMachine) || getGpuService();
      await svc.destroyInstance(String(oldMachine.instance_id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not found|404|does not exist/i.test(msg)) {
        console.warn('[runtime-auto-replace] orphan destroy failed:', msg);
      }
    }
  }
  if (oldMachine) {
    const destroyedAt = new Date().toISOString();
    await supabaseAdmin
      .from('machines')
      .update({
        status: 'destroyed',
        stopped_at: destroyedAt,
        updated_at: destroyedAt,
        gpu_session_id: null,
        billing_started_at: null,
        projection_message: RUNTIME_REPLACE_UX_MESSAGE,
      })
      .eq('id', oldMachineId)
      .neq('status', 'destroyed');
  }

  // 5) Wait until Comfy ready — only then resume live billing (SCB RUNTIME_READY).
  // Do NOT rewrite gpu_sessions.started_at (immutable). Accumulate gap instead.
  let readyMachine = newMachine;
  const gpuService = getGpuServiceForMachine(newMachine) || getGpuService();
  for (let i = 0; i < MAX_READY_POLLS; i++) {
    const live = await resolveLiveMachineStatus(gpuService, readyMachine);
    readyMachine = (await syncMachineFromLiveStatus(supabaseAdmin, readyMachine, live)) || readyMachine;
    if (live.status === 'running' && live.healthOk === true) {
      const readyAt = new Date().toISOString();
      const readyAtMs = Date.parse(readyAt);
      const nextGap = accumulateBillingGapSeconds(
        session.billing_gap_seconds,
        gapStartedMs,
        readyAtMs,
      );
      await supabaseAdmin
        .from('gpu_sessions')
        .update({
          verified_running_at: readyAt,
          billing_gap_seconds: nextGap,
        })
        .eq('id', sessionId)
        .eq('status', 'running');
      await supabaseAdmin
        .from('machines')
        .update({
          billing_started_at: readyAt,
          projection_verified_at: readyAt,
          projection_message: 'Generate đã sẵn sàng',
          updated_at: readyAt,
        })
        .eq('id', readyMachine.id);
      break;
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }

  // 6) Rebind work URL / tokens to new upstream
  const endpoint = buildEndpointFromMachine(readyMachine);
  const nextUpstream =
    endpoint?.comfyUrl ||
    (readyMachine.ip_address && readyMachine.port
      ? `http://${readyMachine.ip_address}:${readyMachine.port}`
      : null);

  let rebind = null;
  if (nextUpstream) {
    rebind = await rebindComfyProxyToRuntime(supabaseAdmin, {
      userId,
      machineId: String(readyMachine.id),
      nextUpstreamUrl: nextUpstream,
      previousUpstreamUrl: previousEndpoint?.comfyUrl ?? null,
      runtimeId: String(readyMachine.instance_id ?? ''),
    });
  }

  return {
    skipped: false,
    sessionId,
    oldMachineId,
    newMachineId: String(readyMachine.id),
    billingStartedAt,
    workUrl: rebind?.workUrl ?? null,
    correlationId,
    planName: params.planName,
    gpuLabel: getGpuLabel(planKey),
  };
}
