/**
 * P1 — Replace dead Runtime while Billing Session stays OPEN.
 * Never Close/settle. Same gpu_sessions.id + started_at.
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
  loadOpenBillableSessionForUser,
} from './runtime-auto-replace-core.js';

export { RUNTIME_REPLACE_UX_MESSAGE, loadOpenBillableSessionForUser };

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
  if (!session || session.status !== 'running' || !session.started_at) {
    return { skipped: true, reason: 'session_not_open_billable' };
  }

  const billingStartedAt = String(params.billingStartedAt || session.started_at);
  const gpuLine = String(params.gpuLine || 'rtx_4090');
  const planKey = String(params.planKey || 'pro');
  const envName = String(params.envName || session.template || 'ComfyUI');

  const { data: oldMachine } = await supabaseAdmin
    .from('machines')
    .select('*')
    .eq('id', oldMachineId)
    .maybeSingle();

  const previousEndpoint = oldMachine ? buildEndpointFromMachine(oldMachine) : null;

  // 1) Orphan destroy provider only — never destroy-pipeline / settle.
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

  const now = new Date().toISOString();
  if (oldMachine) {
    await supabaseAdmin
      .from('machines')
      .update({
        status: 'destroyed',
        stopped_at: now,
        updated_at: now,
        gpu_session_id: null,
        billing_started_at: null,
        projection_message: RUNTIME_REPLACE_UX_MESSAGE,
      })
      .eq('id', oldMachineId);
  }

  // 2) Rent new GPU
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

  // 3) Insert machine linked to SAME billing session
  const newMachine = await insertMachineRecord(supabaseAdmin, userId, {
    ...machineRow,
    gpu_session_id: sessionId,
    billing_started_at: billingStartedAt,
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
    .update({ server_status: 'online', updated_at: now })
    .eq('id', subscriptionId);

  // 4) Wait until Comfy ready (best-effort)
  let readyMachine = newMachine;
  const gpuService = getGpuServiceForMachine(newMachine) || getGpuService();
  for (let i = 0; i < MAX_READY_POLLS; i++) {
    const live = await resolveLiveMachineStatus(gpuService, readyMachine);
    readyMachine = (await syncMachineFromLiveStatus(supabaseAdmin, readyMachine, live)) || readyMachine;
    if (live.status === 'running' && live.healthOk !== false) {
      await supabaseAdmin
        .from('machines')
        .update({
          projection_message: 'ComfyUI sẵn sàng',
          updated_at: new Date().toISOString(),
        })
        .eq('id', readyMachine.id);
      break;
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }

  // 5) Rebind work URL / tokens to new upstream
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
