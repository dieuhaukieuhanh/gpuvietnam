/**
 * Infrastructure Reconciliation — scan and repair orchestration (M13).
 * Delegates repairs to M3/M4/M6/M7 — no new business rules.
 */

import { runDestroyPipeline } from '../destroy-pipeline-run.js';
import {
  closeSession,
  SETTLEMENT_STATUS,
} from '../gpu/session-lifecycle.js';
import {
  createProviderVerifyPortFromGpuService,
  verifyProviderState,
  verifyInstanceDestroyed,
} from '../gpu/provider-verify.js';
import { settleSession, skipSessionSettlement } from '../gpu/settlement.js';
import {
  buildDriftDescriptor,
  dedupeDrifts,
  detectMachineDrifts,
  detectSessionDrifts,
  detectSettlementDrifts,
  DRIFT_TYPE,
  REPAIR_OUTCOME,
  RECONCILIATION_MODULE_VERSION,
} from './reconciliation-core.js';

export {
  buildDriftDescriptor,
  dedupeDrifts,
  detectMachineDrifts,
  detectSessionDrifts,
  detectSettlementDrifts,
  DRIFT_TYPE,
  REPAIR_OUTCOME,
  RECONCILIATION_MODULE_VERSION,
  DEFAULT_STALE_CLOSING_MS,
} from './reconciliation-core.js';

/**
 * @param {Record<string, unknown>} row
 */
function mapSessionRowToRecord(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    status: row.status,
    machineId: row.machine_id != null ? String(row.machine_id) : null,
    started_at: row.started_at ?? null,
    ended_at: row.ended_at ?? null,
    settlement_status: row.settlement_status ?? null,
    destroy_reason: row.destroy_reason ?? null,
    verified_running_at: row.verified_running_at ?? null,
    verified_destroyed_at: row.verified_destroyed_at ?? null,
    created_at: row.created_at ?? null,
  };
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
 * @param {{ state: string; session?: Record<string, unknown> }} result
 */
function assertTransitionOk(result) {
  if (result.state === 'ERROR') {
    const err = new Error(result.message ?? 'session transition error');
    err.code = result.code;
    throw err;
  }
}

/**
 * M13 contract — machine drift scan (detection only).
 * @param {Record<string, unknown>} input
 */
export function reconcileMachine(input = {}) {
  const drifts = detectMachineDrifts(input);
  return {
    state: 'OK',
    drifts,
    message: drifts.length > 0 ? 'drift detected' : 'consistent',
  };
}

/**
 * M13 contract — session drift scan (detection only).
 * @param {Record<string, unknown>} input
 */
export function reconcileSession(input = {}) {
  const drifts = detectSessionDrifts(input);
  return {
    state: 'OK',
    drifts,
    message: drifts.length > 0 ? 'drift detected' : 'consistent',
  };
}

/**
 * M13 contract — settlement drift scan (detection only, no settlement).
 * @param {Record<string, unknown>} input
 */
export function reconcileSettlement(input = {}) {
  const drifts = detectSettlementDrifts(input);
  return {
    state: 'OK',
    drifts,
    message: drifts.length > 0 ? 'drift detected' : 'consistent',
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} drift
 * @param {Record<string, unknown>} deps
 */
async function repairOrphanSession(supabaseAdmin, drift, deps) {
  const sessionId = String(drift.entityId);
  const { data: row, error } = await supabaseAdmin
    .from('gpu_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) throw error;
  if (!row) {
    return { outcome: REPAIR_OUTCOME.SKIPPED, reason: 'session_not_found' };
  }
  if (String(row.status) !== 'running') {
    return { outcome: REPAIR_OUTCOME.ALREADY_CONSISTENT, reason: 'not_running' };
  }

  const record = mapSessionRowToRecord(row);
  const now = deps.now ?? new Date().toISOString();

  // SCB 3.0: an orphan running session (no active machine) is closed directly
  // running -> closed. The provider instance is gone, so provider-destroyed is
  // treated as verified. Settlement is then handled by settlement-drift repair.
  const closeResult = closeSession(
    record,
    { providerDestroyedVerified: true, now },
    {
      ended_at: now,
      verified_destroyed_at: now,
      destroyReason: 'orphan',
    },
  );

  if (closeResult.state === 'IGNORED') {
    return { outcome: REPAIR_OUTCOME.ALREADY_CONSISTENT, reason: 'already_closed' };
  }
  if (closeResult.state !== 'OK') {
    return { outcome: REPAIR_OUTCOME.FAILED, reason: closeResult.message ?? 'close_failed' };
  }
  assertTransitionOk(closeResult);

  await persistSessionRecord(supabaseAdmin, sessionId, closeResult.session);
  deps.log?.('repair orphan session', { sessionId, driftType: drift.driftType });

  return {
    outcome: REPAIR_OUTCOME.REPAIRED,
    action: 'close_orphan',
    sessionId,
    sessionStatus: closeResult.session.status,
    settlementStatus: closeResult.session.settlement_status,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} drift
 * @param {Record<string, unknown>} deps
 */
async function repairViaDestroyPipeline(supabaseAdmin, drift, deps) {
  const userId = String(drift.details?.userId ?? '');
  if (!userId || !deps.gpuService) {
    return { outcome: REPAIR_OUTCOME.FAILED, reason: 'missing_user_or_gpu_service' };
  }

  const pipelineResult = await runDestroyPipeline(
    supabaseAdmin,
    {
      gpuService: deps.gpuService,
      settle: deps.settle ?? settleSession,
      skipSettlement: deps.skipSettlement ?? skipSessionSettlement,
      verifyDestroyed: deps.verifyDestroyed ?? verifyInstanceDestroyed,
    },
    {
      userId,
      reason: 'admin_stop',
      skipBackup: true,
      notifyBackupStart: false,
    },
  );

  deps.log?.('repair via destroy pipeline', {
    driftType: drift.driftType,
    userId,
    pipelineOutcome: pipelineResult.outcome,
  });

  if (
    pipelineResult.outcome === 'destroyed' ||
    pipelineResult.outcome === 'already_destroyed'
  ) {
    return {
      outcome: REPAIR_OUTCOME.REPAIRED,
      action: 'destroy_pipeline',
      pipelineOutcome: pipelineResult.outcome,
    };
  }

  if (pipelineResult.outcome === 'pending_verify') {
    return {
      outcome: REPAIR_OUTCOME.SKIPPED,
      reason: 'pending_verify',
      retryable: pipelineResult.retryable,
    };
  }

  return {
    outcome: REPAIR_OUTCOME.FAILED,
    reason: pipelineResult.outcome,
    retryable: pipelineResult.retryable,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} drift
 * @param {Record<string, unknown>} deps
 */
async function repairSettlementDrift(supabaseAdmin, drift, deps) {
  const sessionId = String(drift.entityId);
  const { data: row, error } = await supabaseAdmin
    .from('gpu_sessions')
    .select(
      'id, user_id, status, settlement_status, verified_destroyed_at, started_at, ended_at',
    )
    .eq('id', sessionId)
    .maybeSingle();

  if (error) throw error;
  if (!row) {
    return { outcome: REPAIR_OUTCOME.SKIPPED, reason: 'session_not_found' };
  }

  const terminal = String(row.settlement_status);
  if (terminal === SETTLEMENT_STATUS.SETTLED || terminal === SETTLEMENT_STATUS.SKIPPED) {
    return { outcome: REPAIR_OUTCOME.ALREADY_CONSISTENT, reason: 'already_settled' };
  }

  if (!row.verified_destroyed_at) {
    return { outcome: REPAIR_OUTCOME.SKIPPED, reason: 'awaiting_provider_verify' };
  }

  const settle = deps.settle ?? settleSession;
  const result = await settle(supabaseAdmin, {
    sessionId,
    userId: String(row.user_id),
    providerDestroyedVerified: true,
  });

  deps.log?.('repair settlement retry', { sessionId, settleState: result.state });

  if (result.state === 'OK' || result.state === 'IDEMPOTENT') {
    return {
      outcome: REPAIR_OUTCOME.REPAIRED,
      action: 'settlement_retry',
      settlementStatus: result.settlementStatus,
    };
  }

  return {
    outcome: REPAIR_OUTCOME.FAILED,
    reason: result.code ?? result.message ?? 'settlement_failed',
    retryable: true,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} drift
 * @param {Record<string, unknown>} deps
 */
export async function repairDriftItem(supabaseAdmin, drift, deps = {}) {
  const driftType = String(drift.driftType);

  if (driftType === DRIFT_TYPE.ORPHAN_SESSION) {
    return repairOrphanSession(supabaseAdmin, drift, deps);
  }

  if (driftType === DRIFT_TYPE.ZOMBIE_LOCAL || driftType === DRIFT_TYPE.STALE_CLOSING) {
    return repairViaDestroyPipeline(supabaseAdmin, drift, deps);
  }

  if (driftType === DRIFT_TYPE.SETTLEMENT_FAILED || driftType === DRIFT_TYPE.SETTLEMENT_PENDING) {
    return repairSettlementDrift(supabaseAdmin, drift, deps);
  }

  if (driftType === DRIFT_TYPE.DESTROYED_MISMATCH || driftType === DRIFT_TYPE.ORPHAN_PROVIDER) {
    deps.log?.('operator required drift', { driftType, entityId: drift.entityId });
    return { outcome: REPAIR_OUTCOME.SKIPPED, reason: 'operator_required' };
  }

  return { outcome: REPAIR_OUTCOME.SKIPPED, reason: 'unsupported_drift' };
}

/**
 * Scan-only reconciliation — does not repair (IMPLEMENTATION_PLAN T3).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} deps
 * @param {{ repair?: boolean, now?: string, limit?: number }} [options]
 */
export async function runInfrastructureReconciliation(supabaseAdmin, deps = {}, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const repair = Boolean(options.repair);
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const log = deps.log ?? ((event, payload) => console.info(`[reconciliation] ${event}`, payload));

  log('scan started', { repair, now });

  const [{ data: sessions }, { data: machines }] = await Promise.all([
    supabaseAdmin
      .from('gpu_sessions')
      .select('*')
      .in('status', ['running', 'closed'])
      .order('started_at', { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from('machines')
      .select('*')
      .in('status', ['creating', 'starting', 'running', 'closing', 'destroyed'])
      .order('updated_at', { ascending: false })
      .limit(limit),
  ]);

  /** @type {ReturnType<typeof buildDriftDescriptor>[]} */
  const drifts = [];
  const machineById = new Map((machines ?? []).map((m) => [String(m.id), m]));
  const machineByUser = new Map();
  for (const machine of machines ?? []) {
    machineByUser.set(String(machine.user_id), machine);
  }

  const verifyPort =
    deps.gpuService != null
      ? createProviderVerifyPortFromGpuService(deps.gpuService)
      : deps.verifyPort ?? null;

  for (const session of sessions ?? []) {
    const machine =
      session.machine_id != null
        ? machineById.get(String(session.machine_id))
        : machineByUser.get(String(session.user_id));

    let providerSnapshot = null;
    let verifyResult = null;

    const instanceId = machine?.instance_id ? String(machine.instance_id) : null;
    if (instanceId && verifyPort) {
      verifyResult = await verifyProviderState(instanceId, verifyPort, { now });
      providerSnapshot = verifyResult.snapshot ?? null;
    }

    drifts.push(
      ...detectSessionDrifts({ session, machine, now }),
      ...detectMachineDrifts({ session, machine, providerSnapshot, verifyResult, now }),
      ...detectSettlementDrifts({ session }),
    );
  }

  for (const machine of machines ?? []) {
    if (!machine.instance_id || !verifyPort) continue;
    const verifyResult = await verifyProviderState(String(machine.instance_id), verifyPort, {
      now,
    });
    const linkedSession = (sessions ?? []).find(
      (s) => String(s.machine_id) === String(machine.id),
    );
    drifts.push(
      ...detectMachineDrifts({
        machine,
        session: linkedSession ?? null,
        providerSnapshot: verifyResult.snapshot ?? null,
        verifyResult,
        now,
      }),
    );
  }

  const uniqueDrifts = dedupeDrifts(drifts);
  log('scan complete', { driftCount: uniqueDrifts.length });

  /** @type {Array<Record<string, unknown>>} */
  const repairs = [];

  if (repair) {
    for (const drift of uniqueDrifts) {
      try {
        const repairResult = await repairDriftItem(supabaseAdmin, drift, { ...deps, now, log });
        repairs.push({ drift, ...repairResult });
        log('repair outcome', { driftType: drift.driftType, ...repairResult });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        repairs.push({ drift, outcome: REPAIR_OUTCOME.FAILED, reason: message });
        log('repair failed', { driftType: drift.driftType, error: message });
      }
    }
  }

  return {
    moduleVersion: RECONCILIATION_MODULE_VERSION,
    startedAt: now,
    repair,
    driftCount: uniqueDrifts.length,
    drifts: uniqueDrifts,
    repairs,
    counts: {
      repaired: repairs.filter((r) => r.outcome === REPAIR_OUTCOME.REPAIRED).length,
      skipped: repairs.filter((r) => r.outcome === REPAIR_OUTCOME.SKIPPED).length,
      failed: repairs.filter((r) => r.outcome === REPAIR_OUTCOME.FAILED).length,
      already_consistent: repairs.filter((r) => r.outcome === REPAIR_OUTCOME.ALREADY_CONSISTENT)
        .length,
    },
  };
}
