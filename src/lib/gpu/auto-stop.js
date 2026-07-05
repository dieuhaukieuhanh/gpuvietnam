import { buildConsumerEndpoint, isEndpointReadyForTraffic } from '@/lib/endpoint-utils';
import { readRemainingForMachine } from './billing.js';
import { getGpuService } from './gpu-service.js';
import { ComfyClient } from './providers/vast/comfy-client.js';
import { runUnifiedDestroy } from '@/lib/destroy-pipeline';
import { notifyAfterMachineDestroy } from '@/lib/machine-destroy';
import {
  updateMachineRecord,
} from '@/lib/machines';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { notifyIdleWarning } from '@/lib/user-notifications';
import {
  AUTO_STOP_DECISION,
  decideAutoStopAction,
  shouldSkipAutoStop,
  shouldStopForOutOfCredit,
} from './auto-stop-core.js';

export {
  AUTO_STOP_MODULE_VERSION,
  AUTO_STOP_DECISION,
  shouldSkipAutoStop,
  shouldStopForOutOfCredit,
  shouldStopForIdle,
  shouldWarnForIdle,
  decideAutoStopAction,
} from './auto-stop-core.js';

export const IDLE_WARN_MINUTES = 55;
export const IDLE_STOP_MINUTES = 60;

/**
 * @param {string | null | undefined} idleStartedAt
 * @returns {number | null}
 */
export function computeIdleMinutes(idleStartedAt) {
  if (!idleStartedAt) return null;
  const started = new Date(String(idleStartedAt)).getTime();
  if (Number.isNaN(started)) return null;
  return Math.max(0, (Date.now() - started) / 60_000);
}

/**
 * @param {Record<string, unknown>} machine
 * @param {boolean} [healthOk]
 */
export async function fetchComfyQueueStats(machine, healthOk = false) {
  if (!isEndpointReadyForTraffic(machine, healthOk)) {
    return { running: 0, pending: 0 };
  }

  const { comfyUrl } = buildConsumerEndpoint(machine, healthOk);
  if (!comfyUrl) {
    return { running: 0, pending: 0 };
  }

  const comfy = new ComfyClient(comfyUrl);
  return comfy.getQueue();
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} machineId
 */
export async function getMachineById(supabaseAdmin, machineId) {
  const { data, error } = await supabaseAdmin
    .from('machines')
    .select('*')
    .eq('id', machineId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} machine
 * @param {{ running: number; pending: number }} queue
 */
async function applyQueueIdleState(supabaseAdmin, machine, queue) {
  const machineId = String(machine.id);
  const hasActiveJobs = queue.running > 0 || queue.pending > 0;

  if (hasActiveJobs) {
    if (machine.idle_started_at || machine.idle_warning_sent) {
      const updated = await updateMachineRecord(supabaseAdmin, machineId, {
        idle_started_at: null,
        idle_warning_sent: false,
      });
      return { machine: updated, hasActiveJobs: true, idleMinutes: null, lastActivity: null };
    }
    return { machine, hasActiveJobs: true, idleMinutes: null, lastActivity: null };
  }

  if (!machine.idle_started_at) {
    const now = new Date().toISOString();
    const updated = await updateMachineRecord(supabaseAdmin, machineId, {
      idle_started_at: now,
      idle_warning_sent: false,
    });
    return {
      machine: updated,
      hasActiveJobs: false,
      idleMinutes: 0,
      lastActivity: now,
    };
  }

  const idleMinutes = computeIdleMinutes(machine.idle_started_at);
  return {
    machine,
    hasActiveJobs: false,
    idleMinutes,
    lastActivity: String(machine.idle_started_at),
  };
}

/**
 * Sync idle timer from ComfyUI queue — idle metadata only (no destroy).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} machine
 */
export async function syncMachineIdleState(supabaseAdmin, machine, options = {}) {
  const healthOk = options.healthOk === true;
  if (!isEndpointReadyForTraffic(machine, healthOk)) {
    return {
      idleMinutes: null,
      lastActivity: null,
      queueRunning: 0,
      queuePending: 0,
      minutesUntilAutoStop: null,
      idleWarningActive: false,
    };
  }

  const { ip } = buildConsumerEndpoint(machine, healthOk);
  if (!ip) {
    return {
      idleMinutes: null,
      lastActivity: null,
      queueRunning: 0,
      queuePending: 0,
      minutesUntilAutoStop: null,
      idleWarningActive: false,
    };
  }

  let queue = { running: 0, pending: 0 };
  try {
    queue = await fetchComfyQueueStats(machine, healthOk);
  } catch (error) {
    console.warn('[auto-stop] queue fetch failed:', error);
    const idleMinutes = computeIdleMinutes(machine.idle_started_at);
    return {
      idleMinutes,
      lastActivity: machine.idle_started_at ? String(machine.idle_started_at) : null,
      queueRunning: 0,
      queuePending: 0,
      minutesUntilAutoStop:
        idleMinutes != null ? Math.max(0, Math.ceil(IDLE_STOP_MINUTES - idleMinutes)) : null,
      idleWarningActive: idleMinutes != null && idleMinutes >= IDLE_WARN_MINUTES,
    };
  }

  const state = await applyQueueIdleState(supabaseAdmin, machine, queue);
  const idleMinutes = state.idleMinutes;

  return {
    idleMinutes,
    lastActivity: state.lastActivity,
    queueRunning: queue.running,
    queuePending: queue.pending,
    minutesUntilAutoStop:
      idleMinutes != null ? Math.max(0, Math.ceil(IDLE_STOP_MINUTES - idleMinutes)) : null,
    idleWarningActive: idleMinutes != null && idleMinutes >= IDLE_WARN_MINUTES,
  };
}

/**
 * Trigger Unified Destroy Pipeline (M7) — sole destroy path from auto-stop.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {string} userId
 * @param {'out_of_credit' | 'idle_timeout'} reason
 * @param {{
 *   gpuService?: import('./gpu-service.js').GPUService;
 *   runDestroy?: typeof runUnifiedDestroy;
 *   notify?: typeof notifyAfterMachineDestroy;
 * }} [deps]
 */
export async function triggerAutoStopDestroy(db, userId, reason, deps = {}) {
  const gpuService = deps.gpuService ?? getGpuService();
  const runDestroy = deps.runDestroy ?? runUnifiedDestroy;
  const notify = deps.notify ?? notifyAfterMachineDestroy;

  const result = await runDestroy(db, gpuService, userId, {
    reason,
    interrupted: reason === 'out_of_credit',
  });

  if (!result.destroyed) {
    if (result.outcome === 'already_destroyed') {
      return {
        action: 'stopped',
        reason,
        idempotent: true,
        pipelineOutcome: result.outcome,
      };
    }
    return {
      action: 'error',
      reason: 'destroy_failed',
      retryable: Boolean(result.retryable),
      pipelineOutcome: result.outcome,
      backupSuccess: result.backupSuccess,
    };
  }

  await notify(db, userId, reason, result.backupSuccess);

  return {
    action: 'stopped',
    reason,
    backupSuccess: result.backupSuccess,
    settlementStatus: result.settlementStatus ?? null,
    verifiedDestroyedAt: result.verifiedDestroyedAt ?? null,
  };
}

/**
 * Decision engine + destroy trigger. Read Remaining (M2) only — no billing writes.
 * @param {import('@supabase/supabase-js').SupabaseClient} [supabaseAdmin]
 * @param {string} machineId
 * @param {{
 *   gpuService?: import('./gpu-service.js').GPUService;
 *   runDestroy?: typeof runUnifiedDestroy;
 *   readRemaining?: typeof readRemainingForMachine;
 *   fetchQueue?: typeof fetchComfyQueueStats;
 * }} [deps]
 */
export async function checkAutoStop(supabaseAdmin, machineId, deps = {}) {
  const db = supabaseAdmin ?? getSupabaseAdmin();
  const machine = await getMachineById(db, machineId);

  if (!machine) {
    return { action: 'skipped', reason: 'not_found' };
  }

  const userId = String(machine.user_id);
  const readRemaining = deps.readRemaining ?? readRemainingForMachine;
  const { remaining, walletBalance } = await readRemaining(db, userId, machine);

  if (shouldSkipAutoStop(String(machine.status ?? ''))) {
    return { action: 'skipped', reason: 'not_running' };
  }

  if (
    shouldStopForOutOfCredit(
      remaining,
      walletBalance,
      Boolean(machine.billing_started_at),
    )
  ) {
    return triggerAutoStopDestroy(
      db,
      userId,
      'out_of_credit',
      deps,
    );
  }

  const healthOk = String(machine.status ?? '') === 'running';
  let queueReachable = isEndpointReadyForTraffic(machine, healthOk);
  let queue = { running: 0, pending: 0 };
  let hasActiveJobs = false;
  let idleMinutes = null;
  let currentMachine = machine;

  if (queueReachable) {
    const fetchQueue = deps.fetchQueue ?? fetchComfyQueueStats;
    try {
      queue = await fetchQueue(machine, healthOk);
      queueReachable = true;
      const state = await applyQueueIdleState(db, machine, queue);
      currentMachine = state.machine;
      hasActiveJobs = state.hasActiveJobs;
      idleMinutes =
        state.idleMinutes ?? computeIdleMinutes(currentMachine.idle_started_at) ?? 0;
    } catch (error) {
      console.warn(`[auto-stop] queue check failed for ${machineId}:`, error);
      queueReachable = false;
    }
  }

  const { ip } = buildConsumerEndpoint(machine, healthOk);
  const decision = decideAutoStopAction({
    machineStatus: String(machine.status ?? ''),
    machineHasBilling: Boolean(machine.billing_started_at),
    remaining,
    walletBalance,
    hasEndpoint: Boolean(ip),
    queueReachable,
    hasActiveJobs,
    idleMinutes,
    idleWarningSent: Boolean(currentMachine.idle_warning_sent),
    idleStopMinutes: IDLE_STOP_MINUTES,
    idleWarnMinutes: IDLE_WARN_MINUTES,
  });

  if (decision.decision === AUTO_STOP_DECISION.SKIPPED) {
    return { action: 'skipped', reason: decision.reason };
  }

  if (decision.decision === AUTO_STOP_DECISION.DESTROY) {
    return triggerAutoStopDestroy(db, userId, /** @type {'out_of_credit'|'idle_timeout'} */ (decision.reason), deps);
  }

  if (decision.decision === AUTO_STOP_DECISION.ERROR) {
    return { action: 'error', reason: decision.reason };
  }

  if (decision.decision === AUTO_STOP_DECISION.ACTIVE) {
    return { action: 'active', queueRunning: queue.running, queuePending: queue.pending };
  }

  if (decision.decision === AUTO_STOP_DECISION.WARN) {
    await notifyIdleWarning(db, { userId });
    await updateMachineRecord(db, String(currentMachine.id), { idle_warning_sent: true });
    return { action: 'warned', idleMinutes: decision.idleMinutes };
  }

  return { action: 'idle', idleMinutes: decision.idleMinutes };
}
