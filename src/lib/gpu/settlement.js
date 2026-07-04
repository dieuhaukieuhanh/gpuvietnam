/**
 * Settlement Domain — M6.
 * Sole entitlement writer for session consumption (SCB §6).
 * Runs only after Provider Verify DESTROYED and session closed.
 * @see docs/SESSION_CENTRIC_BILLING_ARCHITECTURE.md §6
 */

import {
  SETTLEMENT_MODULE_VERSION,
  SETTLEMENT_ERROR_CODE,
  TERMINAL_SETTLEMENT_STATUSES,
  SETTLEABLE_SETTLEMENT_STATUSES,
  calculateBillableSeconds,
  computeAvailableEntitlementSeconds,
  capChargeSeconds,
  allocateSettlementCharge,
  buildSettlementBreakdown,
  evaluateSettlementEligibility,
  isSettlementIdempotentTerminal,
  orderPlansForSettlement,
} from './settlement-core.js';

export {
  SETTLEMENT_MODULE_VERSION,
  SETTLEMENT_ERROR_CODE,
  TERMINAL_SETTLEMENT_STATUSES,
  SETTLEABLE_SETTLEMENT_STATUSES,
  calculateBillableSeconds,
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
 * @param {unknown} value
 * @returns {number}
 */
function roundHours(value) {
  return Math.round(Number(value) * 100) / 100;
}

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
      'id, user_id, status, started_at, ended_at, settlement_status, settlement_at, settlement_breakdown, verified_destroyed_at',
    )
    .eq('id', sessionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} plan
 * @param {number} hours
 */
async function deductHoursFromInventoryPlan(supabaseAdmin, plan, hours) {
  if (hours <= 0) return;

  if (plan.grant_id) {
    const { data: grant } = await supabaseAdmin
      .from('manual_hour_grants')
      .select('hours_used')
      .eq('id', plan.grant_id)
      .single();

    await supabaseAdmin
      .from('manual_hour_grants')
      .update({
        hours_used: roundHours(Number(grant?.hours_used ?? 0) + hours),
      })
      .eq('id', plan.grant_id);
  } else if (plan.subscription_id) {
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('hours_used')
      .eq('id', plan.subscription_id)
      .single();

    await supabaseAdmin
      .from('subscriptions')
      .update({
        hours_used: roundHours(Number(subscription?.hours_used ?? 0) + hours),
      })
      .eq('id', plan.subscription_id);
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {Record<string, unknown>} plan
 * @param {number} hours
 * @param {string} sessionId
 * @returns {Promise<number>}
 */
async function chargeWalletForSession(supabaseAdmin, userId, plan, hours, sessionId) {
  const pricePerHour = Number(plan.price_per_hour ?? 0);
  if (hours <= 0 || pricePerHour <= 0) return 0;

  const walletCharge = Math.round(hours * pricePerHour);
  if (walletCharge <= 0) return 0;

  const txDescription = `GPU session ${sessionId} · ${roundHours(hours)}h · ${plan.plan_name ?? 'hourly'}`;

  const { data: existingTx } = await supabaseAdmin
    .from('wallet_transactions')
    .select('id, amount')
    .eq('user_id', userId)
    .eq('description', txDescription)
    .maybeSingle();

  if (existingTx) {
    return Number(existingTx.amount ?? 0);
  }

  const { data: userRow, error: userError } = await supabaseAdmin
    .from('users')
    .select('wallet_balance')
    .eq('id', userId)
    .single();

  if (userError) throw userError;

  const balance = Number(userRow?.wallet_balance ?? 0);
  const appliedCharge = Math.min(balance, walletCharge);
  if (appliedCharge <= 0) return 0;

  const walletBalanceAfter = balance - appliedCharge;
  const now = new Date().toISOString();

  await supabaseAdmin
    .from('users')
    .update({ wallet_balance: walletBalanceAfter, updated_at: now })
    .eq('id', userId);

  await supabaseAdmin.from('wallet_transactions').insert({
    user_id: userId,
    type: 'payment',
    amount: appliedCharge,
    bonus_amount: 0,
    balance_after: walletBalanceAfter,
    description: txDescription,
    status: 'completed',
  });

  return appliedCharge;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {string} sessionId
 * @param {import('./settlement-core.js').SettlementAllocationLine[]} lines
 * @param {Record<string, unknown>[]} plans
 */
async function commitSettlementLines(supabaseAdmin, userId, sessionId, lines, plans) {
  const planById = new Map(plans.map((plan) => [String(plan.id), plan]));
  let walletCharge = 0;

  for (const line of lines) {
    if (line.source === 'wallet') {
      const plan =
        line.inventoryId != null
          ? planById.get(String(line.inventoryId))
          : plans.find((row) => row.plan_type === 'hourly');
      if (!plan) continue;
      walletCharge += await chargeWalletForSession(
        supabaseAdmin,
        userId,
        plan,
        line.hours,
        sessionId,
      );
      continue;
    }

    const plan =
      line.inventoryId != null
        ? planById.get(String(line.inventoryId))
        : plans.find((row) => {
            if (line.grantId != null) return Number(row.grant_id) === line.grantId;
            if (line.subscriptionId) return String(row.subscription_id) === line.subscriptionId;
            return false;
          });

    if (!plan) continue;
    await deductHoursFromInventoryPlan(supabaseAdmin, plan, line.hours);
  }

  return { walletCharge };
}

/**
 * @param {{ syncUserPlanInventory?: (client: unknown, userId: string) => Promise<unknown> }} deps
 */
async function resolveSyncInventory(deps) {
  if (deps?.syncUserPlanInventory) {
    return deps.syncUserPlanInventory;
  }
  const mod = await import('@/lib/user-plan-inventory');
  return mod.syncUserPlanInventory;
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
    billable_seconds: calculateBillableSeconds(session.started_at, session.ended_at),
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
 * Settle session once — write-once entitlement commit (SCB §6).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   sessionId: string;
 *   userId: string;
 *   providerDestroyedVerified?: boolean;
 * }} input
 * @param {{ syncUserPlanInventory?: (client: unknown, userId: string) => Promise<unknown> }} [deps]
 * @returns {Promise<SettlementResult>}
 */
export async function settleSession(supabaseAdmin, input, deps = {}) {
  const { sessionId, userId } = input;
  const session = await loadSessionForSettlement(supabaseAdmin, sessionId);

  if (!session || String(session.user_id) !== String(userId)) {
    return {
      state: 'ERROR',
      code: SETTLEMENT_ERROR_CODE.SESSION_NOT_FOUND,
      message: 'Session not found',
    };
  }

  if (session.settlement_status === 'settled') {
    return {
      state: 'IDEMPOTENT',
      sessionId,
      settlementStatus: 'settled',
      breakdown: session.settlement_breakdown ?? null,
      billableSeconds: calculateBillableSeconds(session.started_at, session.ended_at),
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
      billableSeconds: calculateBillableSeconds(session.started_at, session.ended_at),
      chargedSeconds: 0,
      walletCharge: 0,
    };
  }

  const eligibility = evaluateSettlementEligibility(session, {
    providerDestroyedVerified: input.providerDestroyedVerified,
  });
  if (!eligibility.ok) {
    return {
      state: 'ERROR',
      code: eligibility.code,
      message: eligibility.message,
    };
  }

  const billableSeconds = calculateBillableSeconds(session.started_at, session.ended_at);
  if (billableSeconds <= 0) {
    return skipSessionSettlement(supabaseAdmin, sessionId, 'zero_billable', { userId });
  }

  const claimableStatuses = [...SETTLEABLE_SETTLEMENT_STATUSES];
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('gpu_sessions')
    .update({ settlement_status: 'in_progress' })
    .eq('id', sessionId)
    .eq('user_id', userId)
    .in('status', ['closed', 'completed'])
    .in('settlement_status', claimableStatuses)
    .select('id')
    .maybeSingle();

  if (claimError) {
    return {
      state: 'ERROR',
      code: SETTLEMENT_ERROR_CODE.COMMIT_FAILED,
      message: claimError.message,
    };
  }

  if (!claimed) {
    const latest = await loadSessionForSettlement(supabaseAdmin, sessionId);
    if (latest?.settlement_status === 'settled' || latest?.settlement_status === 'skipped') {
      return settleSession(supabaseAdmin, input, deps);
    }
    return {
      state: 'ERROR',
      code: SETTLEMENT_ERROR_CODE.INVALID_SETTLEMENT_STATE,
      message: 'Could not claim session for settlement',
    };
  }

  try {
    const [{ data: userRow }, plans] = await Promise.all([
      supabaseAdmin.from('users').select('wallet_balance').eq('id', userId).maybeSingle(),
      fetchBillablePlans(supabaseAdmin, userId),
    ]);

    const walletBalance = Number(userRow?.wallet_balance ?? 0);
    const availableSeconds = computeAvailableEntitlementSeconds(plans, walletBalance);
    const { chargeSeconds, capAppliedSeconds } = capChargeSeconds(billableSeconds, availableSeconds);

    if (chargeSeconds <= 0) {
      const breakdown = buildSettlementBreakdown({
        sessionId,
        billableSeconds,
        chargeSeconds: 0,
        unchargedSeconds: billableSeconds,
        capAppliedSeconds,
        lines: [],
      });

      const now = new Date().toISOString();
      await supabaseAdmin
        .from('gpu_sessions')
        .update({
          settlement_status: 'settled',
          settlement_at: now,
          settlement_breakdown: breakdown,
        })
        .eq('id', sessionId);

      return {
        state: 'OK',
        sessionId,
        settlementStatus: 'settled',
        breakdown,
        billableSeconds,
        chargedSeconds: 0,
        walletCharge: 0,
      };
    }

    const orderedPlans = orderPlansForSettlement(
      plans.map((plan) => ({ ...plan, hours_remaining: Number(plan.hours_remaining ?? 0) })),
    );
    const allocation = allocateSettlementCharge({
      chargeSeconds,
      plans: orderedPlans,
      walletBalance,
    });

    const breakdown = buildSettlementBreakdown({
      sessionId,
      billableSeconds,
      chargeSeconds: allocation.chargedSeconds,
      unchargedSeconds: allocation.unchargedSeconds + (capAppliedSeconds ?? 0),
      capAppliedSeconds,
      lines: allocation.lines,
    });

    const { walletCharge } = await commitSettlementLines(
      supabaseAdmin,
      userId,
      sessionId,
      allocation.lines,
      plans,
    );

    const syncInventory = await resolveSyncInventory(deps);
    await syncInventory(supabaseAdmin, userId);

    const now = new Date().toISOString();
    const { error: finalizeError } = await supabaseAdmin
      .from('gpu_sessions')
      .update({
        settlement_status: 'settled',
        settlement_at: now,
        settlement_breakdown: breakdown,
      })
      .eq('id', sessionId)
      .eq('settlement_status', 'in_progress');

    if (finalizeError) {
      throw finalizeError;
    }

    return {
      state: 'OK',
      sessionId,
      settlementStatus: 'settled',
      breakdown,
      billableSeconds,
      chargedSeconds: allocation.chargedSeconds,
      walletCharge,
    };
  } catch (error) {
    await supabaseAdmin
      .from('gpu_sessions')
      .update({ settlement_status: 'failed' })
      .eq('id', sessionId)
      .eq('settlement_status', 'in_progress');

    return {
      state: 'ERROR',
      code: SETTLEMENT_ERROR_CODE.COMMIT_FAILED,
      message: error instanceof Error ? error.message : String(error),
    };
  }
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
