/**
 * Settlement Domain — SCB 3.4B.
 *
 * Orchestrates session settlement: computes eligibility, billable seconds,
 * allocation, and breakdown in JS (settlement-core.js), reads CAS guard
 * values outside T, then invokes the server-side atomic transaction RPC
 * `settle_session_transaction` (W2–W7). The RPC is the sole entitlement /
 * wallet writer; this module performs no settlement writes. Runs only after
 * Provider Verify DESTROYED and session closed (W1).
 *
 * @see docs/SESSION_CENTRIC_BILLING_ARCHITECTURE.md §6
 * @see docs/scb/SCB_3_4_SPECIFICATION_FREEZE.md
 * @see docs/scb/SCB_3_4A_RPC_DESIGN_CONTRACT.md
 */

import {
  SETTLEMENT_ERROR_CODE,
  calculateBillableSeconds,
  calculateNetBillableSeconds,
  computeAvailableEntitlementSeconds,
  capChargeSeconds,
  allocateSettlementCharge,
  buildSettlementBreakdown,
  evaluateSettlementEligibility,
  orderPlansForSettlement,
} from './settlement-core.js';
import {
  executeSettlementTransaction,
  readCasGuardValues,
  SETTLEMENT_RPC_ERROR,
  isSettlementRpcRetryable,
} from './settlement-transaction-rpc.js';
import { filterEntitlementPlansForMachine } from './remaining-time.js';
import { opsAlertAsync } from '@/lib/ops/alert-dispatcher.js';

export {
  SETTLEMENT_MODULE_VERSION,
  SETTLEMENT_ERROR_CODE,
  TERMINAL_SETTLEMENT_STATUSES,
  SETTLEABLE_SETTLEMENT_STATUSES,
  calculateBillableSeconds,
  calculateNetBillableSeconds,
  computeAvailableEntitlementSeconds,
  capChargeSeconds,
  allocateSettlementCharge,
  buildSettlementBreakdown,
  evaluateSettlementEligibility,
  isSettlementIdempotentTerminal,
  orderPlansForSettlement,
  compareSettlementPlanPriority,
  settlementPlanTier,
  isSettlementPlanUsable,
} from './settlement-core.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function fetchBillablePlans(supabaseAdmin, userId) {
  const { data: rows, error } = await supabaseAdmin
    .from('user_plan_inventory')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) throw error;
  return rows ?? [];
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} sessionId
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function loadSessionForSettlement(supabaseAdmin, sessionId) {
  const { data, error } = await supabaseAdmin
    .from('gpu_sessions')
    .select(
      'id, user_id, status, started_at, ended_at, settlement_status, settlement_at, settlement_breakdown, verified_destroyed_at, machine_id, close_requested_at, billing_gap_seconds',
    )
    .eq('id', sessionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Resolve the machine that owned this session so settlement burns only that package.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} session
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function loadMachineForSettlement(supabaseAdmin, session) {
  const machineId = session?.machine_id != null ? String(session.machine_id) : null;
  if (machineId) {
    const { data, error } = await supabaseAdmin
      .from('machines')
      .select(
        'id, gpu_line, gpu_type, billing_inventory_id, subscription_id',
      )
      .eq('id', machineId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  if (session?.id) {
    const { data, error } = await supabaseAdmin
      .from('machines')
      .select(
        'id, gpu_line, gpu_type, billing_inventory_id, subscription_id',
      )
      .eq('gpu_session_id', String(session.id))
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  return null;
}

/**
 * @typedef {Object} SettlementResultOk
 * @property {'OK'|'IDEMPOTENT'|'SKIPPED'} state
 * @property {string} sessionId
 * @property {string|null} settlementStatus
 * @property {Record<string, unknown>|null} breakdown
 * @property {number} billableSeconds
 * @property {number} chargedSeconds
 * @property {number} walletCharge
 */

/**
 * @typedef {Object} SettlementResultError
 * @property {'ERROR'} state
 * @property {string} code
 * @property {string} message
 */

/** @typedef {SettlementResultOk | SettlementResultError} SettlementResult */

/**
 * Skip settlement — no entitlement write (SCB §6.4).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} sessionId
 * @param {string} [reason]
 * @param {{ userId?: string }} [options]
 * @returns {Promise<SettlementResult>}
 */
export async function skipSessionSettlement(supabaseAdmin, sessionId, reason = 'policy_waive', options = {}) {
  const session = await loadSessionForSettlement(supabaseAdmin, sessionId);
  if (!session) {
    return {
      state: 'ERROR',
      code: SETTLEMENT_ERROR_CODE.SESSION_NOT_FOUND,
      message: 'Session not found',
    };
  }

  if (options.userId && String(session.user_id) !== String(options.userId)) {
    return {
      state: 'ERROR',
      code: SETTLEMENT_ERROR_CODE.SESSION_NOT_FOUND,
      message: 'Session not found for user',
    };
  }

  if (session.settlement_status === 'skipped') {
    return {
      state: 'IDEMPOTENT',
      sessionId,
      settlementStatus: 'skipped',
      breakdown: session.settlement_breakdown ?? null,
      billableSeconds: 0,
      chargedSeconds: 0,
      walletCharge: 0,
    };
  }

  if (session.settlement_status === 'settled') {
    return {
      state: 'ERROR',
      code: SETTLEMENT_ERROR_CODE.ALREADY_SETTLED,
      message: 'Cannot skip — already settled',
    };
  }

  const now = new Date().toISOString();
  const breakdown = {
    skip_reason: reason,
    billable_seconds: calculateNetBillableSeconds(
      session.started_at,
      session.ended_at,
      session.billing_gap_seconds,
    ),
    billing_gap_seconds: Math.max(0, Math.floor(Number(session.billing_gap_seconds) || 0)),
  };

  const { error } = await supabaseAdmin
    .from('gpu_sessions')
    .update({
      settlement_status: 'skipped',
      settlement_at: now,
      settlement_breakdown: breakdown,
    })
    .eq('id', sessionId)
    .neq('settlement_status', 'settled');

  if (error) {
    return {
      state: 'ERROR',
      code: SETTLEMENT_ERROR_CODE.COMMIT_FAILED,
      message: error.message,
    };
  }

  return {
    state: 'SKIPPED',
    sessionId,
    settlementStatus: 'skipped',
    breakdown,
    billableSeconds: breakdown.billable_seconds,
    chargedSeconds: 0,
    walletCharge: 0,
  };
}

/**
 * Settle session once — single atomic server-side transaction (SCB 3.4).
 *
 * SCB 3.4 contract:
 *   - Pre-T (here, JS): load session, evaluate eligibility, compute
 *     billable seconds, allocation, breakdown, and read CAS guard
 *     values (wallet_balance, entitlement hours_used). All business
 *     math stays in JS (settlement-core.js).
 *   - T (server-side RPC `settle_session_transaction`): W2 claim →
 *     W3 wallet debit → W4 ledger insert → W5 entitlement CAS →
 *     W6 projection sync → W7 finalize. Exactly one atomic unit.
 *   - Post-T (destroy-pipeline-run.js): W8–W11, outside T.
 *
 * Replay / idempotency (SCB 3.4 §6, SCB 3.4A §7): the transaction is
 * the replay boundary. A committed T leaves settlement_status='settled';
 * any subsequent call returns IDEMPOTENT (JS pre-check) or CLAIM_LOST
 * (RPC claim guard) → JS re-loads → IDEMPOTENT. No double debit.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   sessionId: string;
 *   userId: string;
 *   providerDestroyedVerified?: boolean;
 * }} input
 * @returns {Promise<SettlementResult>}
 */
export async function settleSession(supabaseAdmin, input) {
  const { sessionId, userId } = input;
  const session = await loadSessionForSettlement(supabaseAdmin, sessionId);

  if (!session || String(session.user_id) !== String(userId)) {
    return {
      state: 'ERROR',
      code: SETTLEMENT_ERROR_CODE.SESSION_NOT_FOUND,
      message: 'Session not found',
    };
  }

  // Pre-RPC idempotency fast path (SCB 3.4A §7): a terminal session is
  // returned IDEMPOTENT without invoking the RPC.
  if (session.settlement_status === 'settled') {
    return {
      state: 'IDEMPOTENT',
      sessionId,
      settlementStatus: 'settled',
      breakdown: session.settlement_breakdown ?? null,
      billableSeconds: calculateNetBillableSeconds(
        session.started_at,
        session.ended_at,
        session.billing_gap_seconds,
      ),
      chargedSeconds: Number(session.settlement_breakdown?.charged_seconds ?? 0),
      walletCharge: Number(session.settlement_breakdown?.wallet?.vnd ?? 0),
    };
  }

  if (session.settlement_status === 'skipped') {
    return {
      state: 'IDEMPOTENT',
      sessionId,
      settlementStatus: 'skipped',
      breakdown: session.settlement_breakdown ?? null,
      billableSeconds: calculateNetBillableSeconds(
        session.started_at,
        session.ended_at,
        session.billing_gap_seconds,
      ),
      chargedSeconds: 0,
      walletCharge: 0,
    };
  }

  // Eligibility — pure JS (settlement-core.js). P0-B: billing Close OR destroy verify.
  const eligibility = evaluateSettlementEligibility(session, {
    providerDestroyedVerified: input.providerDestroyedVerified,
    billingCloseVerified:
      input.billingCloseVerified === true || Boolean(session.close_requested_at),
  });
  if (!eligibility.ok) {
    return {
      state: 'ERROR',
      code: eligibility.code,
      message: eligibility.message,
    };
  }

  // Zero-billable → skip (non-financial, outside T). Net of auto-replace gaps.
  const billableSeconds = calculateNetBillableSeconds(
    session.started_at,
    session.ended_at,
    session.billing_gap_seconds,
  );
  if (billableSeconds <= 0) {
    return skipSessionSettlement(supabaseAdmin, sessionId, 'zero_billable', { userId });
  }

  // Guard: epoch / corrupt started_at (e.g. 1970-01-01) must never charge.
  const startedMs = session.started_at ? new Date(session.started_at).getTime() : NaN;
  if (!Number.isFinite(startedMs) || startedMs < Date.UTC(2000, 0, 1)) {
    return skipSessionSettlement(supabaseAdmin, sessionId, 'invalid_started_at', { userId });
  }

  // Guard: absurd duration (corrupt timestamps) — refuse to burn entitlements.
  const MAX_BILLABLE_SECONDS = 7 * 24 * 3600;
  if (billableSeconds > MAX_BILLABLE_SECONDS) {
    return skipSessionSettlement(supabaseAdmin, sessionId, 'billable_exceeds_7d_guard', {
      userId,
    });
  }

  // ──────────────── PRE-T (JS business math) ────────────────
  // All allocation / breakdown math stays in JS. The RPC receives the
  // prepared plan and executes it atomically (SCB 3.4A §2).
  const [{ data: userRow }, plans, machine] = await Promise.all([
    supabaseAdmin.from('users').select('wallet_balance').eq('id', userId).maybeSingle(),
    fetchBillablePlans(supabaseAdmin, userId),
    loadMachineForSettlement(supabaseAdmin, session),
  ]);

  // Burn only the package this session ran on (Starter/Pro/Studio). Soonest
  // expiry first inside that package — never across other GPU tiers.
  const scopedPlans = machine ? filterEntitlementPlansForMachine(plans, machine) : plans;

  const walletBalance = Number(userRow?.wallet_balance ?? 0);
  const availableSeconds = computeAvailableEntitlementSeconds(scopedPlans, walletBalance);
  const { chargeSeconds, capAppliedSeconds } = capChargeSeconds(billableSeconds, availableSeconds);

  /** @type {import('./settlement-core.js').SettlementAllocationLine[]} */
  let allocationLines = [];
  let chargedSeconds = 0;
  let unchargedSeconds = billableSeconds;

  if (chargeSeconds <= 0) {
    // Billable but nothing available to charge (cap applied). Route through
    // the RPC with empty wallet_charge / entitlement_lines so the
    // pending → settled transition is still atomic (W2 → W7 with W3–W6
    // skipped). Breakdown records the uncharged seconds. Preserves the
    // previous skipSessionSettlement behaviour (uncharged_seconds = billable).
    allocationLines = [];
    chargedSeconds = 0;
    unchargedSeconds = billableSeconds;
  } else {
    const orderedPlans = orderPlansForSettlement(
      scopedPlans.map((plan) => ({ ...plan, hours_remaining: Number(plan.hours_remaining ?? 0) })),
    );
    const allocation = allocateSettlementCharge({
      chargeSeconds,
      plans: orderedPlans,
      walletBalance,
    });
    allocationLines = allocation.lines;
    chargedSeconds = allocation.chargedSeconds;
    unchargedSeconds = allocation.unchargedSeconds + (capAppliedSeconds ?? 0);
  }

  const breakdown = {
    ...buildSettlementBreakdown({
      sessionId,
      billableSeconds,
      chargeSeconds: chargedSeconds,
      unchargedSeconds,
      capAppliedSeconds,
      lines: allocationLines,
    }),
    billing_gap_seconds: Math.max(0, Math.floor(Number(session.billing_gap_seconds) || 0)),
  };

  // Read CAS guard values OUTSIDE T (SCB 3.4A §9 pre-RPC). These are
  // inputs to the server-side CAS inside T; the RPC's claim guard and
  // row locks are the authoritative protection.
  const { walletBalance: casWalletBalance, entitlementReads } = await readCasGuardValues(
    supabaseAdmin,
    userId,
    allocationLines,
    scopedPlans,
  );

  const settlementAt = new Date().toISOString();

  // ──────────────── T (single server-side RPC) ────────────────
  const rpcResult = await executeSettlementTransaction(supabaseAdmin, {
    sessionId,
    userId,
    providerDestroyedVerified: input.providerDestroyedVerified === true,
    billingCloseVerified:
      input.billingCloseVerified === true || Boolean(session.close_requested_at),
    expectedPreSettlementStatus: String(session.settlement_status),
    lines: allocationLines,
    plans: scopedPlans,
    breakdown,
    billableSeconds,
    chargedSeconds,
    walletBalance: casWalletBalance,
    entitlementReads,
    settlementAt,
  });

  // ──────────────── POST-RPC classification (SCB 3.4A §9) ────────────────
  if (rpcResult.state === 'OK' || rpcResult.state === 'IDEMPOTENT') {
    // Hours may have hit zero — refresh backup quota / grace clock (non-fatal).
    try {
      const { syncUserBackupEntitlement } = await import('../backup-entitlement.js');
      await syncUserBackupEntitlement(supabaseAdmin, userId);
    } catch (err) {
      console.warn(
        '[settleSession] syncUserBackupEntitlement failed (non-fatal):',
        err instanceof Error ? err.message : err,
      );
    }

    // Preserve the existing SettlementResult shape exactly.
    return {
      state: rpcResult.state,
      sessionId,
      settlementStatus: rpcResult.settlementStatus ?? 'settled',
      breakdown,
      billableSeconds,
      chargedSeconds,
      walletCharge: Number(rpcResult.walletCharge ?? 0),
    };
  }

  // ERROR — T rolled back; no partial financial state persists (SCB 3.4A §6).
  const code = String(rpcResult.code ?? SETTLEMENT_RPC_ERROR.INTERNAL);

  if (code === SETTLEMENT_RPC_ERROR.CLAIM_LOST) {
    // Re-load session; if a rival committed → IDEMPOTENT, else retry once
    // with a fresh expected_pre_settlement_status (preserves the existing
    // single-retry-on-claim-failure behaviour under the new RPC contract).
    const latest = await loadSessionForSettlement(supabaseAdmin, sessionId);
    if (latest?.settlement_status === 'settled' || latest?.settlement_status === 'skipped') {
      return settleSession(supabaseAdmin, input);
    }
    return {
      state: 'ERROR',
      code: SETTLEMENT_ERROR_CODE.INVALID_SETTLEMENT_STATE,
      message: 'Settlement claim lost to a concurrent settler',
    };
  }

  if (code === SETTLEMENT_RPC_ERROR.LEDGER_CONFLICT) {
    // Possible prior committed T (duplicate idempotency_key). Re-load; if
    // settled → IDEMPOTENT, else escalate (SCB 3.4A §9).
    const latest = await loadSessionForSettlement(supabaseAdmin, sessionId);
    if (latest?.settlement_status === 'settled') {
      return settleSession(supabaseAdmin, input);
    }
    return {
      state: 'ERROR',
      code: SETTLEMENT_ERROR_CODE.COMMIT_FAILED,
      message: 'Settlement ledger conflict — possible duplicate; investigate',
    };
  }

  if (code === SETTLEMENT_RPC_ERROR.CLAIM_PRECONDITION) {
    // Abort; surface to reconciliation (SCB 3.4A §9). This covers the
    // stuck in_progress / awaiting_verify cases that are not inline-settleable
    // under SCB 3.4 (no in_progress lease — §9 known limitation).
    return {
      state: 'ERROR',
      code: SETTLEMENT_ERROR_CODE.INVALID_SETTLEMENT_STATE,
      message: rpcResult.message ?? 'Settlement precondition not met',
    };
  }

  // WALLET_CAS / CAS_EXHAUSTED / PROJECTION_FAILED / INTERNAL → retryable.
  // Preserve existing logging style (console.error, same as prior catch path).
  if (isSettlementRpcRetryable(code)) {
    console.error('[settlement] transaction RPC failed (retryable):', code, rpcResult.message);
    opsAlertAsync({
      event: 'settlement_failed',
      severity: 'critical',
      title: `Settlement RPC failed (${code})`,
      details: { sessionId, userId, code, message: rpcResult.message },
      dedupeKey: `settlement_failed:${sessionId}:${code}`,
    });
    return {
      state: 'ERROR',
      code: SETTLEMENT_ERROR_CODE.COMMIT_FAILED,
      message: rpcResult.message ?? 'Settlement transaction failed',
    };
  }

  // Unknown code — treat as internal/retryable.
  console.error('[settlement] transaction RPC failed (unknown code):', code, rpcResult.message);
  opsAlertAsync({
    event: 'settlement_failed',
    severity: 'critical',
    title: `Settlement RPC failed (unknown:${code})`,
    details: { sessionId, userId, code, message: rpcResult.message },
    dedupeKey: `settlement_failed:${sessionId}:${code}`,
  });
  return {
    state: 'ERROR',
    code: SETTLEMENT_ERROR_CODE.COMMIT_FAILED,
    message: rpcResult.message ?? 'Settlement transaction failed',
  };
}

/**
 * Legacy wrapper — delegates to {@link settleSession} when preconditions met.
 * Does not write entitlement outside Settlement Domain.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {string} instanceId
 * @param {{ providerDestroyedVerified?: boolean }} [options]
 */
export async function settleSessionForMachine(supabaseAdmin, userId, instanceId, options = {}) {
  const { data: machine } = await supabaseAdmin
    .from('machines')
    .select('gpu_session_id, billing_started_at')
    .eq('user_id', userId)
    .eq('instance_id', instanceId)
    .maybeSingle();

  const sessionId = machine?.gpu_session_id ? String(machine.gpu_session_id) : null;
  if (!sessionId) {
    return { settled: false, skipped: true, reason: 'no_session' };
  }

  const result = await settleSession(supabaseAdmin, {
    sessionId,
    userId,
    providerDestroyedVerified: options.providerDestroyedVerified,
  });

  return { ...result, sessionId };
}
