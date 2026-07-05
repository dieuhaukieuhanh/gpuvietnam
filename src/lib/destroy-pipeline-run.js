/**
 * Unified Destroy Pipeline — orchestration core (M7).
 * Node-testable: relative imports only, billing/backup wired via deps.
 */

import { DEFAULT_GPU_PORT } from './gpu/gpu-config.js';
import {
  createProviderVerifyPortFromGpuService,
  verifyInstanceDestroyed,
  isVerifyPass,
} from './gpu/provider-verify.js';
import {
  closeSession,
  SETTLEMENT_STATUS,
} from './gpu/session-lifecycle.js';
import { calculateBillableSeconds } from './gpu/settlement-core.js';
import {
  DESTROY_PIPELINE_STEP,
  DESTROY_PIPELINE_OUTCOME,
  mapDestroyedVerifyOutcome,
  isDestroyVerifyRetryable,
  isSessionReadyForSettlement,
  isSessionTerminalSettled,
  normalizePipelineDestroyReason,
  shouldRunBackup,
  machineHasBillableSession,
  isProvenDestroySession,
} from './destroy-pipeline-core.js';
import { profStart, profEnd } from './prof.js';

const ACTIVE_MACHINE_STATUSES = ['creating', 'starting', 'running'];

/**
 * @param {Record<string, unknown> | null | undefined} machine
 */
function extractEndpointFromMachine(machine) {
  const ip = typeof machine?.ip_address === 'string' ? machine.ip_address : null;
  const port = Number(machine?.port ?? DEFAULT_GPU_PORT);
  return { ip, port };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
async function resolveActiveMachine(supabaseAdmin, userId) {
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
 * @param {unknown} value
 * @returns {number}
 */
function roundHours(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * @param {Record<string, unknown>} row
 * @param {string|null} [machineId]
 */
function toSessionRecord(row, machineId = null) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    status: row.status,
    machineId: row.machine_id ? String(row.machine_id) : machineId ? String(machineId) : null,
    started_at: row.started_at ? String(row.started_at) : null,
    ended_at: row.ended_at ? String(row.ended_at) : null,
    settlement_status: row.settlement_status ?? null,
    destroy_reason: row.destroy_reason ? String(row.destroy_reason) : null,
    verified_running_at: row.verified_running_at ? String(row.verified_running_at) : null,
    verified_destroyed_at: row.verified_destroyed_at
      ? String(row.verified_destroyed_at)
      : null,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} sessionId
 */
async function loadSessionRow(supabaseAdmin, sessionId) {
  const { data, error } = await supabaseAdmin
    .from('gpu_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} sessionId
 * @param {Record<string, unknown>} record
 */
async function persistSessionRecord(supabaseAdmin, sessionId, record) {
  const { error } = await supabaseAdmin
    .from('gpu_sessions')
    .update({
      status: record.status,
      ended_at: record.ended_at,
      settlement_status: record.settlement_status,
      destroy_reason: record.destroy_reason,
      verified_destroyed_at: record.verified_destroyed_at,
    })
    .eq('id', sessionId);
  if (error) throw error;
}

/**
 * @param {{ state: string; message?: string; code?: string }} result
 */
function assertTransitionOk(result) {
  if (result.state === 'ERROR') {
    const err = new Error(result.message ?? 'transition error');
    err.code = result.code;
    throw err;
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
async function markSubscriptionOffline(supabaseAdmin, userId) {
  const { data: subscription, error: subError } = await supabaseAdmin
    .from('subscriptions')
    .select('id, server_status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subError) throw subError;
  if (!subscription || subscription.server_status === 'offline') return;

  const { error: updateError } = await supabaseAdmin
    .from('subscriptions')
    .update({ server_status: 'offline' })
    .eq('id', subscription.id);

  if (updateError) throw updateError;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} machine
 */
async function markMachineDestroyed(supabaseAdmin, machine) {
  await supabaseAdmin
    .from('machines')
    .update({
      status: 'destroyed',
      stopped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', machine.id);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   gpuService: { destroyInstance: (id: string) => Promise<void> };
 *   verifyDestroyed?: typeof verifyInstanceDestroyed;
 *   settle?: (client: unknown, input: object) => Promise<Record<string, unknown>>;
 *   skipSettlement?: (client: unknown, sessionId: string, reason: string, opts: object) => Promise<Record<string, unknown>>;
 *   collectSessionMetrics?: (machine: Record<string, unknown>) => Promise<{ vramAvg: null; outputCount: number }>;
 *   finalizeGpuSession?: (client: unknown, machine: Record<string, unknown>, billingResult: object, metrics: object) => Promise<unknown>;
 *   clearMachineBillingFields?: (client: unknown, machineId: string) => Promise<void>;
 *   backupBeforeStop?: (client: unknown, machine: Record<string, unknown>, userId: string, reason: string) => Promise<boolean>;
 *   notifyBackupStarted?: (client: unknown, opts: { userId: string }) => Promise<void>;
 *   onStep?: (step: string) => void;
 * }} deps
 * @param {{
 *   userId: string;
 *   machine?: Record<string, unknown>|null;
 *   reason?: string|null;
 *   skipBackup?: boolean;
 *   skipBilling?: boolean;
 *   skipMetrics?: boolean;
 *   notifyBackupStart?: boolean;
 * }} input
 */
export async function runDestroyPipeline(supabaseAdmin, deps, input) {
  const __prof = profStart('runDestroyPipeline');
  try {
  const stepTrace = /** @type {string[]} */ ([]);
  const trace = (step) => {
    stepTrace.push(step);
    deps.onStep?.(step);
  };

  const userId = input.userId;
  const destroyReason = normalizePipelineDestroyReason(input.reason);
  const verifyDestroyed = deps.verifyDestroyed ?? verifyInstanceDestroyed;
  const collectMetrics =
    deps.collectSessionMetrics ?? (async () => ({ vramAvg: null, outputCount: 0 }));
  const finalizeSession = deps.finalizeGpuSession ?? (async () => null);
  const clearBillingFields = deps.clearMachineBillingFields ?? (async () => {});

  trace(DESTROY_PIPELINE_STEP.RESOLVE);

  let machine = input.machine;
  if (machine === undefined) {
    machine = await resolveActiveMachine(supabaseAdmin, userId);
  }

  if (!machine?.instance_id) {
    return {
      destroyed: false,
      outcome: DESTROY_PIPELINE_OUTCOME.NO_MACHINE,
      lastStep: DESTROY_PIPELINE_STEP.RESOLVE,
      machine: null,
      session: null,
      settlement: null,
      verify: null,
      backupSuccess: null,
      reason: input.reason ?? null,
      retryable: false,
      billingResult: null,
      metrics: null,
      stepTrace,
    };
  }

  if (String(machine.status ?? '') === 'destroyed') {
    // SCB 3.4 §9 / SCB 3.4A §9 — W11 reachability fix: the ALREADY_DESTROYED
    // early-return previously skipped markSubscriptionOffline, leaving the
    // subscription stuck `online` when a retry re-entered the pipeline after
    // the machine row was already marked destroyed. W11 is idempotent and
    // outside T (SCB 3.4 §1 step 19); make it retry-reachable here so a
    // retry converges the subscription projection. The other post-T steps
    // (W8–W10) are correctly skipped — they already ran on the prior pass
    // that destroyed the machine, and re-running them would be redundant.
    await markSubscriptionOffline(supabaseAdmin, userId);
    return {
      destroyed: true,
      outcome: DESTROY_PIPELINE_OUTCOME.ALREADY_DESTROYED,
      lastStep: DESTROY_PIPELINE_STEP.COMPLETE,
      machine,
      session: null,
      settlement: null,
      verify: null,
      backupSuccess: null,
      reason: destroyReason,
      retryable: false,
      billingResult: null,
      metrics: null,
      stepTrace,
    };
  }

  let backupSuccess = null;
  if (shouldRunBackup(machine, input) && deps.backupBeforeStop) {
    trace(DESTROY_PIPELINE_STEP.BACKUP);
    if (input.notifyBackupStart !== false && deps.notifyBackupStarted) {
      try {
        await deps.notifyBackupStarted(supabaseAdmin, { userId });
      } catch (error) {
        console.warn('[destroy-pipeline] backup started notification failed:', error);
      }
    }
    try {
      backupSuccess = await deps.backupBeforeStop(
        supabaseAdmin,
        machine,
        userId,
        destroyReason,
      );
    } catch (error) {
      console.error('[destroy-pipeline] backup failed:', error);
      backupSuccess = false;
    }
  }

  let metrics = { vramAvg: null, outputCount: 0 };
  if (!input.skipMetrics) {
    try {
      metrics = await collectMetrics(machine);
    } catch (error) {
      console.warn('[destroy-pipeline] collectSessionMetrics failed:', error);
    }
  }

  const instanceId = String(machine.instance_id);
  const { port } = extractEndpointFromMachine(machine);
  const verifyPort = createProviderVerifyPortFromGpuService(deps.gpuService);

  let sessionRow = null;
  const sessionId = machine.gpu_session_id ? String(machine.gpu_session_id) : null;

  if (sessionId) {
    const candidate = await loadSessionRow(supabaseAdmin, sessionId);
    if (machineHasBillableSession(machine)) {
      sessionRow = candidate;
    } else if (isProvenDestroySession(candidate, machine)) {
      sessionRow = candidate;
    }
  }

  let sessionRecord = toSessionRecord(sessionRow, String(machine.id));

  // SCB 3.0: no `closing` intermediate state. A running session stays running
  // until provider-destroyed is verified, then transitions directly to closed.

  let verifyResult = null;

  const preVerify = await verifyDestroyed(instanceId, verifyPort, { port });
  const preOutcome = mapDestroyedVerifyOutcome(preVerify);

  if (preOutcome !== 'destroyed') {
    trace(DESTROY_PIPELINE_STEP.PROVIDER_DESTROY);
    try {
      await deps.gpuService.destroyInstance(instanceId);
    } catch (error) {
      console.warn('[destroy-pipeline] provider destroy failed:', error);
      return {
        destroyed: false,
        outcome: DESTROY_PIPELINE_OUTCOME.PROVIDER_DESTROY_FAILED,
        lastStep: DESTROY_PIPELINE_STEP.PROVIDER_DESTROY,
        machine,
        session: sessionRow,
        settlement: null,
        verify: null,
        backupSuccess,
        reason: destroyReason,
        retryable: true,
        billingResult: null,
        metrics,
        stepTrace,
      };
    }
  }

  trace(DESTROY_PIPELINE_STEP.VERIFY_DESTROYED);
  verifyResult = await verifyDestroyed(instanceId, verifyPort, { port });
  const verifyOutcome = mapDestroyedVerifyOutcome(verifyResult);

  if (verifyOutcome === 'still_running') {
    // Session never left `running`; nothing to roll back. The destroy did not
    // complete — the instance is still alive and the session remains billable.
    return {
      destroyed: false,
      outcome: DESTROY_PIPELINE_OUTCOME.ROLLED_BACK,
      lastStep: DESTROY_PIPELINE_STEP.VERIFY_DESTROYED,
      machine,
      session: sessionRow,
      settlement: null,
      verify: verifyResult,
      backupSuccess,
      reason: destroyReason,
      retryable: true,
      billingResult: null,
      metrics,
      stepTrace,
    };
  }

  if (!isVerifyPass(verifyResult, 'destroyed')) {
    const retryable = isDestroyVerifyRetryable(verifyOutcome);
    return {
      destroyed: false,
      outcome: DESTROY_PIPELINE_OUTCOME.PENDING_VERIFY,
      lastStep: DESTROY_PIPELINE_STEP.VERIFY_DESTROYED,
      machine,
      session: sessionRow,
      settlement: null,
      verify: verifyResult,
      backupSuccess,
      reason: destroyReason,
      retryable,
      billingResult: null,
      metrics,
      stepTrace,
    };
  }

  const verifiedAt = verifyResult.verifiedAt ?? new Date().toISOString();

  if (sessionRecord && sessionRecord.status === 'running') {
    trace(DESTROY_PIPELINE_STEP.SESSION_CLOSED);
    const closeResult = closeSession(
      sessionRecord,
      { providerDestroyedVerified: true, now: verifiedAt },
      {
        ended_at: verifiedAt,
        verified_destroyed_at: verifiedAt,
        destroyReason,
      },
    );
    assertTransitionOk(closeResult);
    sessionRecord = closeResult.session;
    await persistSessionRecord(supabaseAdmin, sessionId, sessionRecord);
    sessionRow = { ...sessionRow, ...sessionRecord };
  } else if (sessionRecord && sessionRecord.status === 'closed') {
    trace(DESTROY_PIPELINE_STEP.SESSION_CLOSED);
  }

  /** @type {Record<string, unknown>|null} */
  let settlementResult = null;

  if (sessionId && sessionRow && isSessionReadyForSettlement(sessionRow) && deps.settle && deps.skipSettlement) {
    trace(DESTROY_PIPELINE_STEP.SETTLEMENT);
    if (input.skipBilling) {
      settlementResult = await deps.skipSettlement(supabaseAdmin, sessionId, 'billing_waived', {
        userId,
      });
    } else if (!isSessionTerminalSettled(sessionRow)) {
      settlementResult = await deps.settle(supabaseAdmin, {
        sessionId,
        userId,
        providerDestroyedVerified: true,
      });
    } else {
      settlementResult = {
        state: 'IDEMPOTENT',
        sessionId,
        settlementStatus: String(sessionRow.settlement_status),
        breakdown: sessionRow.settlement_breakdown ?? null,
        billableSeconds: calculateBillableSeconds(sessionRow.started_at, sessionRow.ended_at),
        chargedSeconds: 0,
        walletCharge: 0,
      };
    }

    if (settlementResult?.state === 'ERROR') {
      return {
        destroyed: false,
        outcome: DESTROY_PIPELINE_OUTCOME.SETTLEMENT_FAILED,
        lastStep: DESTROY_PIPELINE_STEP.SETTLEMENT,
        machine,
        session: sessionRow,
        settlement: settlementResult,
        verify: verifyResult,
        backupSuccess,
        reason: destroyReason,
        retryable: true,
        billingResult: null,
        metrics,
        stepTrace,
        verifiedDestroyedAt: verifiedAt,
        settlementStatus: sessionRow.settlement_status ?? SETTLEMENT_STATUS.FAILED,
      };
    }
  }

  trace(DESTROY_PIPELINE_STEP.CLEANUP);

  const billableSeconds =
    sessionRow?.started_at && sessionRow?.ended_at
      ? calculateBillableSeconds(sessionRow.started_at, sessionRow.ended_at)
      : 0;

  const billingResult = {
    durationSeconds: billableSeconds,
    hoursUsed: roundHours(billableSeconds / 3600),
    sessionId,
    endedAt: sessionRow?.ended_at ?? verifiedAt,
    settlement: settlementResult,
    walletCharge: Number(settlementResult?.walletCharge ?? 0),
    remainderSeconds: Number(settlementResult?.chargedSeconds ?? 0),
    remainderHours: roundHours(Number(settlementResult?.chargedSeconds ?? 0) / 3600),
  };

  if (sessionId) {
    try {
      await finalizeSession(supabaseAdmin, machine, billingResult, metrics);
    } catch (error) {
      console.warn('[destroy-pipeline] finalizeGpuSession failed:', error);
    }
  }

  await clearBillingFields(supabaseAdmin, String(machine.id));
  await markMachineDestroyed(supabaseAdmin, machine);
  await markSubscriptionOffline(supabaseAdmin, userId);

  trace(DESTROY_PIPELINE_STEP.COMPLETE);

  return {
    destroyed: true,
    outcome: DESTROY_PIPELINE_OUTCOME.DESTROYED,
    lastStep: DESTROY_PIPELINE_STEP.COMPLETE,
    machine,
    session: sessionRow,
    settlement: settlementResult,
    verify: verifyResult,
    backupSuccess,
    reason: destroyReason,
    retryable: false,
    billingResult,
    metrics,
    stepTrace,
    verifiedDestroyedAt: verifiedAt,
    settlementStatus:
      settlementResult?.settlementStatus ?? sessionRow?.settlement_status ?? null,
  };
  } finally { profEnd(__prof); }
}
