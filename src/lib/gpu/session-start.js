/**
 * Session start API orchestration (M9) — M3 lifecycle + M4 verify, no billing formulas.
 */

import { randomUUID } from 'node:crypto';

import { getPlanNameFromKey } from '@/lib/gpu-pricing';
import { parseInventoryId } from '@/lib/user-plan-inventory';

import {
  closeOrphanRunningSessionsLifecycle,
} from './session-orphan-close.js';
import {
  findMachineForBilling,
  linkMachineToBillingSession,
  fetchOrderedBillablePlansForUser,
} from './billing.js';
import { isMachineBillingAnchorValid, parseValidSessionStartedMs } from './billing-anchor-core.js';
import {
  createPendingSession,
  activateRunningSession,
  SETTLEMENT_STATUS,
} from './session-lifecycle.js';
import {
  activateSessionRow,
  ACTIVATE_OUTCOME,
} from './session-activate.js';
import { isProjectionTrafficReady } from '../scb-read-path.js';
import { isEndpointResolved } from '../endpoint-utils.js';
import {
  verifyInstanceRunning,
  createProviderVerifyPortFromGpuService,
  isVerifyPass,
} from './provider-verify.js';
import { selectPrimaryBillablePlanForMachine } from './remaining-time.js';
import {
  RUNTIME_READY_FOR_BILLING,
  isRuntimeReadyForBilling,
} from './billing-session-p0b.js';

/**
 * @param {Record<string, unknown>} row
 */
function mapGpuSessionRowToRecord(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
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
 * @param {string} userId
 * @param {Record<string, unknown>} machine
 */
async function loadBootstrapContext(supabaseAdmin, userId, machine) {
  const machineSubId =
    machine?.subscription_id != null && String(machine.subscription_id).trim() !== ''
      ? String(machine.subscription_id)
      : null;

  const [subscriptionResult, plans] = await Promise.all([
    machineSubId
      ? supabaseAdmin.from('subscriptions').select('*').eq('id', machineSubId).maybeSingle()
      : supabaseAdmin
          .from('subscriptions')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
    fetchOrderedBillablePlansForUser(supabaseAdmin, userId),
  ]);
  const subscription = subscriptionResult.data ?? null;

  // Gift-first burn order is global; must scope to this machine's package first
  // or Pro sessions incorrectly link to the newest Starter gift row.
  const primaryPlan = selectPrimaryBillablePlanForMachine(plans, machine, subscription);
  const inventoryId = parseInventoryId(primaryPlan?.id);
  const envIcon = subscription?.env_icon ? `${subscription.env_icon} ` : '';
  const template = `${envIcon}${machine.template ?? subscription?.env_name ?? 'ComfyUI'}`.trim();
  const plan = subscription?.plan ?? getPlanNameFromKey(primaryPlan?.plan_name) ?? 'Pro';
  const billing = subscription?.billing ?? primaryPlan?.billing ?? 'combo1';

  return {
    subscription,
    primaryPlan,
    inventoryId,
    template,
    plan,
    billing,
    gpuConfig: subscription?.gpu_label ?? null,
  };
}

/**
 * @param {{ started_at?: string | null }} session
 * @param {{ created_at?: string | null }} machine
 */
function sessionBelongsToMachine(session, machine) {
  if (!session?.started_at) return false;
  if (machine?.id && session?.machine_id && String(session.machine_id) === String(machine.id)) {
    return true;
  }
  if (!machine?.created_at) return false;
  const sessionStart = new Date(String(session.started_at)).getTime();
  const machineCreated = new Date(String(machine.created_at)).getTime();
  if (!Number.isFinite(sessionStart) || !Number.isFinite(machineCreated)) return false;
  return sessionStart >= machineCreated - 5000;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string | null | undefined} sessionId
 * @param {string | null | undefined} [machineId] — when provided, falls back to FK lookup
 *   via gpu_sessions.machine_id if sessionId is missing or the row is not found.
 */
export async function loadActiveSessionRow(supabaseAdmin, sessionId, machineId = null) {
  if (sessionId) {
    const { data, error } = await supabaseAdmin
      .from('gpu_sessions')
      .select(
        'id, status, settlement_status, verified_running_at, verified_destroyed_at, started_at, ended_at',
      )
      .eq('id', String(sessionId))
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  // FK fallback: projection gpu_session_id drifted — query by authoritative relationship.
  if (machineId) {
    const { data, error } = await supabaseAdmin
      .from('gpu_sessions')
      .select(
        'id, status, settlement_status, verified_running_at, verified_destroyed_at, started_at, ended_at',
      )
      .eq('machine_id', String(machineId))
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  return null;
}

/**
 * Open billable session: M4 verify RUNNING → M3 pending → running → machine anchor.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {string} instanceId
 * @param {import('./gpu-service.js').GPUService} gpuService
 */
function scbObs(step, info) {
  console.log('[SCB-DBG][openBillableSession] ' + step, JSON.stringify(info));
}

export async function openBillableSession(supabaseAdmin, userId, instanceId, gpuService) {
  scbObs('ENTER', { userId, instanceId });
  const machine = await findMachineForBilling(supabaseAdmin, userId, instanceId);
  scbObs('after findMachineForBilling', {
    userId,
    instanceId,
    machineId: machine?.id ?? null,
    machineStatus: machine?.status ?? null,
    gpu_session_id: machine?.gpu_session_id ?? null,
    billing_started_at: machine?.billing_started_at ?? null,
  });
  if (!machine) {
    scbObs('RETURN skip', { reason: 'machine_not_found', userId, instanceId });
    return { skipped: true, reason: 'machine_not_found' };
  }

  if (String(machine.status ?? '') !== 'running') {
    scbObs('RETURN skip', {
      reason: 'machine_not_running',
      machineId: machine.id,
      machineStatus: machine.status,
      gpu_session_id: machine.gpu_session_id ?? null,
      billing_started_at: machine.billing_started_at ?? null,
    });
    return { skipped: true, reason: 'machine_not_running' };
  }

  // SCB 3.2 — lifecycle close of orphan running sessions (was a billing call
  // that after M4 no longer closes lifecycle state, leaving users blocked by
  // the per-user unique index). This closes running -> closed via the state
  // machine and persists ONLY lifecycle fields. No settlement/billing/wallet/
  // inventory. See session-orphan-close.js.
  const orphanResult = await closeOrphanRunningSessionsLifecycle(supabaseAdmin, userId);
  scbObs('after closeOrphanRunningSessionsLifecycle', {
    userId,
    machineId: machine.id,
    closed: orphanResult.closed,
    skipped: orphanResult.skipped,
    orphanSessionIds: orphanResult.sessionIds,
    gpu_session_id: machine.gpu_session_id ?? null,
    billing_started_at: machine.billing_started_at ?? null,
  });

  if (machine.billing_started_at) {
    const linkedSessionId = machine.gpu_session_id ? String(machine.gpu_session_id) : null;
    scbObs('branch machine.billing_started_at set', {
      machineId: machine.id,
      billing_started_at: machine.billing_started_at,
      gpu_session_id: machine.gpu_session_id ?? null,
      linkedSessionId,
    });
    if (linkedSessionId) {
      const linkedSession = await loadActiveSessionRow(supabaseAdmin, linkedSessionId);
      scbObs('after loadActiveSessionRow (linked)', {
        machineId: machine.id,
        linkedSessionId,
        linkedStatus: linkedSession?.status ?? null,
        linkedStartedAt: linkedSession?.started_at ?? null,
        belongs: linkedSession ? sessionBelongsToMachine(linkedSession, machine) : null,
      });
      if (
        linkedSession?.status === 'running' &&
        linkedSession.started_at &&
        sessionBelongsToMachine(linkedSession, machine) &&
        isMachineBillingAnchorValid(String(linkedSession.started_at), machine)
      ) {
        scbObs('RETURN alreadyStarted', {
          machineId: machine.id,
          sessionId: linkedSessionId,
          startedAt: machine.billing_started_at,
          state: 'running',
        });
        return {
          alreadyStarted: true,
          sessionId: linkedSessionId,
          startedAt: machine.billing_started_at,
          sessionStatus: 'running',
          settlementStatus: linkedSession.settlement_status ?? null,
          verifiedRunningAt: linkedSession.verified_running_at ?? null,
          verifyStatus: 'ok',
        };
      }
    }
  }

  // P0-B: only RUNTIME_READY_FOR_BILLING may open the billable clock.
  // Pre-check Workspace attachability; provider RUNNING verify follows.
  if (!isProjectionTrafficReady(machine) && !isEndpointResolved(machine)) {
    scbObs('RETURN skip', {
      reason: 'traffic_not_ready',
      machineId: machine.id,
      projection_verified_at: machine.projection_verified_at ?? null,
      projection_message: machine.projection_message ?? null,
    });
    return { skipped: true, reason: 'traffic_not_ready' };
  }

  const verifyPort = createProviderVerifyPortFromGpuService(gpuService);
  const nowIso = new Date().toISOString();
  const verifyResult = await verifyInstanceRunning(String(instanceId), verifyPort, { now: nowIso });
  const verifyStatus = verifyResult.state;
  scbObs('after verifyInstanceRunning', {
    machineId: machine.id,
    instanceId,
    verifyStatus,
    isVerifyPass: isVerifyPass(verifyResult, 'running'),
  });

  if (!isVerifyPass(verifyResult, 'running')) {
    scbObs('RETURN skip', {
      reason: 'verify_not_pass',
      machineId: machine.id,
      verifyStatus,
    });
    return {
      skipped: true,
      reason: 'verify_not_pass',
      verifyStatus,
      verifyResult,
    };
  }

  if (!isRuntimeReadyForBilling(machine, { providerRunningVerified: true })) {
    scbObs('RETURN skip', {
      reason: 'runtime_not_ready_for_billing',
      machineId: machine.id,
    });
    return { skipped: true, reason: 'runtime_not_ready_for_billing' };
  }

  const verifiedAt =
    parseValidSessionStartedMs(verifyResult.verifiedAt) != null
      ? String(verifyResult.verifiedAt)
      : nowIso;
  const bootstrap = await loadBootstrapContext(supabaseAdmin, userId, machine);
  scbObs('after loadBootstrapContext', {
    machineId: machine.id,
    subscriptionId: bootstrap.subscription?.id ?? null,
    subscriptionStatus: bootstrap.subscription?.status ?? null,
    inventoryId: bootstrap.inventoryId ?? null,
  });
  const context = {
    subscriptionActive: bootstrap.subscription?.status === 'active',
    providerRunningVerified: true,
    machineExists: true,
    otherRunningSessionCount: 0,
    now: verifiedAt,
  };
  scbObs('context built', {
    machineId: machine.id,
    subscriptionActive: context.subscriptionActive,
    now: context.now,
  });

  let pendingRow = null;
  if (machine.gpu_session_id) {
    scbObs('branch machine.gpu_session_id set', {
      machineId: machine.id,
      gpu_session_id: machine.gpu_session_id,
    });
    const { data: linked } = await supabaseAdmin
      .from('gpu_sessions')
      .select('*')
      .eq('id', String(machine.gpu_session_id))
      .maybeSingle();
    scbObs('after gpu_sessions.select by gpu_session_id', {
      machineId: machine.id,
      linkedId: linked?.id ?? null,
      linkedStatus: linked?.status ?? null,
      linkedStartedAt: linked?.started_at ?? null,
    });

    if (
      linked?.status === 'running' &&
      linked.started_at &&
      isMachineBillingAnchorValid(String(linked.started_at), machine)
    ) {
      try {
        await linkMachineToBillingSession(
          supabaseAdmin,
          machine,
          String(linked.id),
          String(linked.started_at),
          bootstrap.inventoryId,
        );
        scbObs('after linkMachineToBillingSession (linked running reuse)', {
          machineId: machine.id,
          sessionId: linked.id,
          startedAt: linked.started_at,
          ok: true,
        });
      } catch (projectionError) {
        scbObs('after linkMachineToBillingSession (linked running reuse) THREW', {
          machineId: machine.id,
          sessionId: linked.id,
          error: projectionError instanceof Error ? projectionError.message : String(projectionError),
        });
        console.warn('[openBillableSession] projection write failed (non-fatal, will self-heal on read):', projectionError);
      }
      scbObs('RETURN reused (linked running)', {
        machineId: machine.id,
        sessionId: linked.id,
        startedAt: linked.started_at,
        state: 'running',
      });
      return {
        sessionId: linked.id,
        startedAt: linked.started_at,
        inventoryId: bootstrap.inventoryId,
        reused: true,
        sessionStatus: 'running',
        settlementStatus: linked.settlement_status ?? null,
        verifiedRunningAt: linked.verified_running_at ?? null,
        verifyStatus,
      };
    }

    if (linked?.status === 'pending') {
      pendingRow = linked;
      scbObs('pendingRow set from linked', {
        machineId: machine.id,
        pendingRowId: pendingRow.id,
      });
    }
  } else {
    scbObs('branch machine.gpu_session_id NULL → FK fallback', {
      machineId: machine.id,
    });
    // W4 writer-side FK reuse: projection gpu_session_id drifted NULL.
    // Mirror resolveBillingAnchor() read-path strategy — query the authoritative
    // relationship gpu_sessions.machine_id before creating a new session, so we
    // reuse the existing running session instead of duplicating it.
    const { data: fkLinked, error: fkError } = await supabaseAdmin
      .from('gpu_sessions')
      .select('*')
      .eq('machine_id', String(machine.id))
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    scbObs('after gpu_sessions.select FK fallback', {
      machineId: machine.id,
      fkError: fkError ? String(fkError.message) : null,
      fkLinkedId: fkLinked?.id ?? null,
      fkLinkedStatus: fkLinked?.status ?? null,
      fkLinkedStartedAt: fkLinked?.started_at ?? null,
    });
    if (fkError) throw fkError;

    if (
      fkLinked?.status === 'running' &&
      fkLinked.started_at &&
      isMachineBillingAnchorValid(String(fkLinked.started_at), machine)
    ) {
      try {
        await linkMachineToBillingSession(
          supabaseAdmin,
          machine,
          String(fkLinked.id),
          String(fkLinked.started_at),
          bootstrap.inventoryId,
        );
        scbObs('after linkMachineToBillingSession (FK fallback reuse)', {
          machineId: machine.id,
          sessionId: fkLinked.id,
          startedAt: fkLinked.started_at,
          ok: true,
        });
      } catch (projectionError) {
        scbObs('after linkMachineToBillingSession (FK fallback reuse) THREW', {
          machineId: machine.id,
          sessionId: fkLinked.id,
          error: projectionError instanceof Error ? projectionError.message : String(projectionError),
        });
        console.warn('[openBillableSession] projection write failed (non-fatal, will self-heal on read):', projectionError);
      }
      scbObs('RETURN reused (FK fallback)', {
        machineId: machine.id,
        sessionId: fkLinked.id,
        startedAt: fkLinked.started_at,
        state: 'running',
      });
      return {
        sessionId: fkLinked.id,
        startedAt: fkLinked.started_at,
        inventoryId: bootstrap.inventoryId,
        reused: true,
        reusedViaFkFallback: true,
        sessionStatus: 'running',
        settlementStatus: fkLinked.settlement_status ?? null,
        verifiedRunningAt: fkLinked.verified_running_at ?? null,
        verifyStatus,
      };
    }
  }

  let sessionId = pendingRow ? String(pendingRow.id) : randomUUID();
  let sessionRecord;
  scbObs('before create/activate', {
    machineId: machine.id,
    sessionId,
    pendingRowPresent: Boolean(pendingRow),
  });

  if (!pendingRow) {
    const pendingResult = createPendingSession(
      {
        id: sessionId,
        userId,
        machineId: String(machine.id),
        created_at: verifiedAt,
      },
      context,
    );
    scbObs('after createPendingSession', {
      machineId: machine.id,
      sessionId,
      state: pendingResult.state,
      code: pendingResult.code ?? null,
      message: pendingResult.message ?? null,
      hasSession: Boolean(pendingResult.session),
    });

    if (pendingResult.state === 'ERROR') {
      scbObs('THROW createPendingSession ERROR', {
        machineId: machine.id,
        sessionId,
        code: pendingResult.code,
        message: pendingResult.message,
      });
      throw new Error(pendingResult.message ?? 'createPendingSession failed');
    }

    sessionRecord = pendingResult.session;
    scbObs('sessionRecord from createPendingSession', {
      machineId: machine.id,
      sessionId,
      recordStatus: sessionRecord?.status ?? null,
      recordStartedAt: sessionRecord?.started_at ?? null,
    });

    const { error: insertError } = await supabaseAdmin.from('gpu_sessions').insert({
      id: sessionId,
      user_id: userId,
      subscription_id: bootstrap.subscription?.id ?? machine.subscription_id,
      machine_id: machine.id,
      template: bootstrap.template,
      plan: bootstrap.plan,
      billing: bootstrap.billing,
      gpu_config: bootstrap.gpuConfig,
      status: 'pending',
      settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE,
      duration_seconds: 0,
    });
    scbObs('after gpu_sessions.insert (pending)', {
      machineId: machine.id,
      sessionId,
      insertError: insertError ? String(insertError.message) : null,
    });

    if (insertError) {
      scbObs('THROW insertError', {
        machineId: machine.id,
        sessionId,
        error: String(insertError.message),
      });
      throw insertError;
    }

    const { error: machineUpdateError } = await supabaseAdmin
      .from('machines')
      .update({ gpu_session_id: sessionId, updated_at: verifiedAt })
      .eq('id', machine.id);
    scbObs('after machines.update (gpu_session_id)', {
      machineId: machine.id,
      sessionId,
      machineUpdateError: machineUpdateError ? String(machineUpdateError.message) : null,
    });
    // Legacy DBs may still have machines.gpu_session_id as bigint — non-fatal;
    // authoritative link is gpu_sessions.machine_id; linkMachineToBillingSession
    // self-heals billing_started_at later with column-type fallbacks.
  } else {
    sessionRecord = mapGpuSessionRowToRecord(pendingRow);
    scbObs('sessionRecord from pendingRow', {
      machineId: machine.id,
      sessionId,
      recordStatus: sessionRecord?.status ?? null,
      recordStartedAt: sessionRecord?.started_at ?? null,
    });
  }

  const activateResult = activateRunningSession(sessionRecord, context, {
    started_at: verifiedAt,
    verified_running_at: verifiedAt,
  });
  scbObs('after activateRunningSession', {
    machineId: machine.id,
    sessionId,
    state: activateResult.state,
    code: activateResult.code ?? null,
    message: activateResult.message ?? null,
    hasSession: Boolean(activateResult.session),
    activatedStatus: activateResult.session?.status ?? null,
    activatedStartedAt: activateResult.session?.started_at ?? null,
  });

  if (activateResult.state === 'ERROR') {
    scbObs('THROW activateRunningSession ERROR', {
      machineId: machine.id,
      sessionId,
      code: activateResult.code,
      message: activateResult.message,
    });
    throw new Error(activateResult.message ?? 'activateRunningSession failed');
  }

  const activated = activateResult.session;

  // SCB 3.1 — Optimistic concurrency: the update is guarded by `status='pending'`.
  // If a concurrent flow already moved the row (close/re-activate/delete) the
  // update affects 0 rows → we return a clear domain result, no retry, no force.
  // started_at is set ONCE here (pending rows have NULL started_at per SCB
  // invariant); the guard guarantees we never overwrite a row that left pending.
  const activateRow = await activateSessionRow(supabaseAdmin, sessionId, {
    status: activated.status,
    started_at: activated.started_at,
    verified_running_at: activated.verified_running_at,
    settlement_status: activated.settlement_status,
  });
  scbObs('after activateSessionRow', {
    machineId: machine.id,
    sessionId,
    outcome: activateRow.outcome,
    currentStatus: activateRow.currentStatus ?? activateRow.session?.status ?? null,
    activatedStartedAt: activated.started_at,
  });

  if (activateRow.outcome === ACTIVATE_OUTCOME.ERROR) {
    scbObs('THROW activateSessionRow ERROR', {
      machineId: machine.id,
      sessionId,
      error: activateRow.error ?? null,
    });
    throw new Error(activateRow.error ?? 'activateSessionRow failed');
  }

  // Concurrent activate won — treat as already started (idempotent success).
  if (activateRow.outcome === ACTIVATE_OUTCOME.ALREADY_RUNNING) {
    const running = activateRow.session;
    scbObs('RETURN alreadyStarted (concurrent activate won)', {
      machineId: machine.id,
      sessionId,
      startedAt: running?.started_at ?? activated.started_at,
    });
    return {
      alreadyStarted: true,
      sessionId,
      startedAt: running?.started_at ?? activated.started_at ?? verifiedAt,
      sessionStatus: 'running',
      settlementStatus: running?.settlement_status ?? activated.settlement_status ?? null,
      verifiedRunningAt: running?.verified_running_at ?? activated.verified_running_at ?? verifiedAt,
      verifyStatus,
    };
  }

  // Session was closed by a concurrent flow — do not link machine projection.
  if (activateRow.outcome === ACTIVATE_OUTCOME.CLOSED) {
    scbObs('RETURN skipped (session closed by concurrent flow)', {
      machineId: machine.id,
      sessionId,
    });
    return {
      skipped: true,
      reason: 'session_closed',
      sessionId,
      sessionStatus: 'closed',
    };
  }

  // Any other concurrent transition (e.g. row deleted) — surface clearly.
  if (activateRow.outcome === ACTIVATE_OUTCOME.CONCURRENT_TRANSITION) {
    scbObs('RETURN skipped (concurrent transition)', {
      machineId: machine.id,
      sessionId,
      currentStatus: activateRow.currentStatus ?? null,
    });
    return {
      skipped: true,
      reason: 'concurrent_transition',
      sessionId,
      currentStatus: activateRow.currentStatus ?? null,
    };
  }

  // ACTIVATED — P0-B sole billable start (RUNTIME_READY_FOR_BILLING).
  scbObs(RUNTIME_READY_FOR_BILLING, {
    machineId: machine.id,
    sessionId,
    started_at: activated.started_at ?? verifiedAt,
    event: RUNTIME_READY_FOR_BILLING,
  });

  try {
    await linkMachineToBillingSession(
      supabaseAdmin,
      machine,
      sessionId,
      String(activated.started_at ?? verifiedAt),
      bootstrap.inventoryId,
    );
    scbObs('after linkMachineToBillingSession', {
      machineId: machine.id,
      sessionId,
      startedAt: String(activated.started_at ?? verifiedAt),
      ok: true,
    });
  } catch (projectionError) {
    scbObs('after linkMachineToBillingSession THREW', {
      machineId: machine.id,
      sessionId,
      error: projectionError instanceof Error ? projectionError.message : String(projectionError),
    });
    console.warn('[openBillableSession] projection write failed (non-fatal, will self-heal on read):', projectionError);
  }

  scbObs('RETURN success', {
    machineId: machine.id,
    sessionId,
    startedAt: activated.started_at ?? verifiedAt,
    state: 'running',
    settlementStatus: activated.settlement_status ?? null,
    verifiedRunningAt: activated.verified_running_at ?? null,
  });
  return {
    sessionId,
    startedAt: activated.started_at ?? verifiedAt,
    inventoryId: bootstrap.inventoryId,
    sessionStatus: 'running',
    settlementStatus: activated.settlement_status ?? null,
    verifiedRunningAt: activated.verified_running_at ?? verifiedAt,
    verifyStatus,
  };
}

/**
 * Create `pending` session when machine is provisioned (start-machine path).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   userId: string;
 *   machine: Record<string, unknown>;
 *   subscription: Record<string, unknown>;
 *   template: string;
 *   plan: string;
 *   billing: string;
 *   gpuConfig?: string | null;
 * }} input
 */
export async function createProvisioningPendingSession(supabaseAdmin, input) {
  const { userId, machine, subscription } = input;
  const now = new Date().toISOString();

  if (machine.gpu_session_id) {
    const existing = await loadActiveSessionRow(supabaseAdmin, String(machine.gpu_session_id));
    if (existing?.status === 'pending' || existing?.status === 'running') {
      return {
        sessionId: String(machine.gpu_session_id),
        sessionStatus: existing.status,
        skipped: true,
        reason: 'already_linked',
      };
    }
  }

  const context = {
    subscriptionActive: subscription?.status === 'active',
    otherRunningSessionCount: 0,
    now,
  };

  const sessionId = randomUUID();
  const pendingResult = createPendingSession(
    {
      id: sessionId,
      userId,
      machineId: String(machine.id),
      created_at: now,
    },
    context,
  );

  if (pendingResult.state === 'ERROR') {
    return {
      skipped: true,
      reason: pendingResult.message ?? 'create_pending_failed',
      code: pendingResult.code ?? null,
    };
  }

  const { error: insertError } = await supabaseAdmin.from('gpu_sessions').insert({
    id: sessionId,
    user_id: userId,
    subscription_id: subscription.id,
    machine_id: machine.id,
    template: input.template,
    plan: input.plan,
    billing: input.billing,
    gpu_config: input.gpuConfig ?? null,
    status: 'pending',
    settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE,
    duration_seconds: 0,
  });

  if (insertError) throw insertError;

  await supabaseAdmin
    .from('machines')
    .update({ gpu_session_id: sessionId, updated_at: now })
    .eq('id', machine.id);

  return {
    sessionId,
    sessionStatus: 'pending',
    settlementStatus: SETTLEMENT_STATUS.NOT_APPLICABLE,
  };
}

/**
 * Cancel a pending session for a user (cancel-start path).
 *
 * ADR (SCB 3.0): a `pending` session that never reaches `running` is
 * DELETED, not transitioned to a terminal state. The state machine has no
 * `pending -> closed` transition, so the row is removed from `gpu_sessions`
 * and the machine projection link is cleared. This is not a state-machine
 * transition; it is disposal of a never-billable provisioning record.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function interruptPendingSessionForUser(supabaseAdmin, userId) {
  const { data: pending, error } = await supabaseAdmin
    .from('gpu_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!pending) {
    return { skipped: true, reason: 'no_pending_session' };
  }

  const sessionId = String(pending.id);

  const { error: deleteError } = await supabaseAdmin
    .from('gpu_sessions')
    .delete()
    .eq('id', sessionId);

  if (deleteError) throw deleteError;

  if (pending.machine_id) {
    await supabaseAdmin
      .from('machines')
      .update({ gpu_session_id: null, updated_at: new Date().toISOString() })
      .eq('id', String(pending.machine_id));
  }

  return {
    sessionId,
    deleted: true,
    reason: 'pending_session_cancelled',
  };
}
