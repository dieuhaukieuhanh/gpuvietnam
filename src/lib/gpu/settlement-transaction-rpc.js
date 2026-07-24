/**
 * SCB 3.4B — Settlement Transaction RPC client wrapper.
 *
 * Authority:
 *   docs/scb/SCB_3_4_SPECIFICATION_FREEZE.md  (frozen architecture)
 *   docs/scb/SCB_3_4A_RPC_DESIGN_CONTRACT.md  (frozen RPC contract)
 *
 * Role (SCB 3.4A §2 / §9):
 *   This module is the JS-side binding to the server-side
 *   `settle_session_transaction(json)` PostgREST RPC. It:
 *     1. Reads `users.wallet_balance` and each entitlement row's
 *        `hours_used` OUTSIDE T (SCB 3.4A §9 pre-RPC: "Read ...
 *        for CAS guard values") so the RPC payload carries the CAS
 *        guard values the server will use inside T.
 *     2. Assembles the SCB 3.4A §3 input payload from the JS-prepared
 *        allocation lines + breakdown (computed in settlement-core.js).
 *     3. Invokes `supabaseAdmin.rpc('settle_session_transaction', { payload })`.
 *     4. Translates the SCB 3.4A §4 response into the existing
 *        `SettlementResult` shape consumed by destroy-pipeline-run.js,
 *        reconciliation.js, and the settlement tests.
 *     5. Classifies ERROR codes per SCB 3.4A §9 so callers can
 *        retry / surface-to-reconciliation / treat-as-idempotent.
 *
 * It computes NO business math. Allocation, breakdown, eligibility,
 * wallet-charge amount, and plan ordering all stay in settlement-core.js.
 *
 * Node-testable: relative imports only, no `@/lib` aliases.
 */

/** @typedef {import('./settlement-core.js').SettlementAllocationLine} SettlementAllocationLine */

/**
 * SCB 3.4A §4 error codes. Mirror of the server-side contract.
 * @enum {string}
 */
export const SETTLEMENT_RPC_ERROR = Object.freeze({
  CLAIM_LOST: 'CLAIM_LOST',
  CLAIM_PRECONDITION: 'CLAIM_PRECONDITION',
  CAS_EXHAUSTED: 'CAS_EXHAUSTED',
  WALLET_CAS: 'WALLET_CAS',
  LEDGER_CONFLICT: 'LEDGER_CONFLICT',
  PROJECTION_FAILED: 'PROJECTION_FAILED',
  INTERNAL: 'INTERNAL',
});

/**
 * Retryable ERROR codes per SCB 3.4A §9:
 *   "ERROR WALLET_CAS / CAS_EXHAUSTED / PROJECTION_FAILED / INTERNAL → backoff retry."
 *   CLAIM_LOST → re-load session (handled by settleSession, not blind retry).
 *   CLAIM_PRECONDITION → abort; surface to reconciliation.
 *   LEDGER_CONFLICT → re-load session; if settled → IDEMPOTENT; else escalate.
 * @param {string} code
 * @returns {boolean}
 */
export function isSettlementRpcRetryable(code) {
  return (
    code === SETTLEMENT_RPC_ERROR.WALLET_CAS ||
    code === SETTLEMENT_RPC_ERROR.CAS_EXHAUSTED ||
    code === SETTLEMENT_RPC_ERROR.PROJECTION_FAILED ||
    code === SETTLEMENT_RPC_ERROR.INTERNAL
  );
}

/**
 * Map an RPC `entitlement_lines` entry to its target table + id, using the
 * SCB allocation plan-resolution rule:
 *   - manual_grant / gift (grant-backed) → manual_hour_grants.grant_id
 *   - combo (subscription-backed)         → subscriptions.subscription_id
 *   - wallet                              → not an entitlement line (wallet)
 * Returns null for lines that have no resolvable entitlement target
 * (wallet lines and any line lacking grant/subscription/inventory resolution).
 *
 * @param {SettlementAllocationLine} line
 * @param {Record<string, unknown>[]} plans
 * @returns {{ table: 'manual_hour_grants'|'subscriptions', id: string|number } | null}
 */
function resolveEntitlementTarget(line, plans) {
  if (line.source === 'wallet') return null;

  if (line.grantId != null) {
    return { table: 'manual_hour_grants', id: line.grantId };
  }
  if (line.subscriptionId != null) {
    return { table: 'subscriptions', id: line.subscriptionId };
  }
  // Fall back to resolving via the inventory plan row (defence in depth —
  // planById / find-by-subscription-id resolution).
  const plan =
    line.inventoryId != null
      ? plans.find((row) => String(row.id) === String(line.inventoryId))
      : plans.find((row) => {
          if (row.grant_id != null && row.grant_id !== '') return false;
          return row.subscription_id != null;
        });
  if (plan?.grant_id != null && plan.grant_id !== '') {
    return { table: 'manual_hour_grants', id: Number(plan.grant_id) };
  }
  if (plan?.subscription_id != null) {
    return { table: 'subscriptions', id: String(plan.subscription_id) };
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function roundHours(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Read the CAS guard values OUTSIDE T per SCB 3.4A §9 pre-RPC:
 *   - users.wallet_balance  (for wallet_charge.balance_after)
 *   - each entitlement target's hours_used (for line.expected_hours_used)
 *
 * These reads are NOT inside the transaction; they are inputs to it. The
 * server-side CAS inside T is the authoritative guard; these values are
 * what JS observed and what the RPC's first CAS attempt compares against.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {SettlementAllocationLine[]} lines
 * @param {Record<string, unknown>[]} plans
 * @returns {Promise<{ walletBalance: number, entitlementReads: Map<string, number> }>}
 */
export async function readCasGuardValues(supabaseAdmin, userId, lines, plans) {
  const { data: userRow, error: userError } = await supabaseAdmin
    .from('users')
    .select('wallet_balance')
    .eq('id', userId)
    .maybeSingle();
  if (userError) throw userError;
  const walletBalance = Number(userRow?.wallet_balance ?? 0);

  /** @type {Map<string, number>} keyed by `${table}:${id}` */
  const entitlementReads = new Map();

  for (const line of lines) {
    if (line.source === 'wallet') continue;
    if (line.hours <= 0) continue;
    const target = resolveEntitlementTarget(line, plans);
    if (!target) continue;

    const key = `${target.table}:${target.id}`;
    if (entitlementReads.has(key)) continue;

    const { data: row, error: readError } = await supabaseAdmin
      .from(target.table)
      .select('hours_used')
      .eq('id', target.id)
      .maybeSingle();
    if (readError) throw readError;
    entitlementReads.set(key, Number(row?.hours_used ?? 0));
  }

  return { walletBalance, entitlementReads };
}

/**
 * Build the SCB 3.4A §3 RPC payload from the JS-prepared settlement plan.
 *
 * Wallet aggregation: one wallet line in the allocation maps to one
 * wallet_charge object (amount = sum of line.walletVnd, clamped to
 * walletBalance so the debit can never go negative — preserves the
 * `Math.min(balance, walletCharge)` clamp. description follows the format
 * `GPU session <sid> · <hours>h · <plan_name>`.
 *
 * Entitlement aggregation: one entitlement_line per non-wallet line that
 * resolves to a target, carrying the JS-read `expected_hours_used` as the
 * CAS guard value (SCB 3.4A §3 / §4 note on `expected_hours_used`).
 *
 * @param {{
 *   sessionId: string;
 *   userId: string;
 *   providerDestroyedVerified: boolean;
 *   billingCloseVerified?: boolean;
 *   expectedPreSettlementStatus: string;
 *   lines: SettlementAllocationLine[];
 *   plans: Record<string, unknown>[];
 *   breakdown: Record<string, unknown>;
 *   walletBalance: number;
 *   entitlementReads: Map<string, number>;
 *   settlementAt?: string;
 * }} input
 * @returns {Record<string, unknown>}
 */
export function buildSettlementTransactionPayload(input) {
  const settlementAt = input.settlementAt ?? new Date().toISOString();
  const idempotencyKey = `settle:${input.sessionId}`;

  // --- Wallet charge aggregation (W3/W4) ---
  let walletAmount = 0;
  let walletHours = 0;
  /** @type {string|null} */
  let walletPlanName = null;
  for (const line of input.lines) {
    if (line.source !== 'wallet') continue;
    walletAmount += Number(line.walletVnd ?? 0);
    walletHours = roundHours(walletHours + line.hours);
    if (!walletPlanName) {
      const plan =
        line.inventoryId != null
          ? input.plans.find((row) => String(row.id) === String(line.inventoryId))
          : input.plans.find((row) => row.plan_type === 'hourly');
      walletPlanName = plan?.plan_name ?? 'hourly';
    }
  }

  // Preserve legacy "can't go negative" clamp (Math.min(balance, charge)).
  const appliedWalletAmount = Math.min(Number(input.walletBalance ?? 0), walletAmount);
  /** @type {{ amount: number, description: string, balance_after: number } | null} */
  let walletCharge = null;
  if (appliedWalletAmount > 0) {
    const balanceAfter = Math.max(0, Number(input.walletBalance ?? 0) - appliedWalletAmount);
    const description = `GPU session ${input.sessionId} · ${walletHours}h · ${walletPlanName ?? 'hourly'}`;
    walletCharge = { amount: appliedWalletAmount, description, balance_after: balanceAfter };
  }

  // --- Entitlement lines (W5) ---
  /** @type {Array<{ table: 'manual_hour_grants'|'subscriptions', id: string|number, hours: number, expected_hours_used: number }>} */
  const entitlementLines = [];
  for (const line of input.lines) {
    if (line.source === 'wallet') continue;
    if (line.hours <= 0) continue;
    const target = resolveEntitlementTarget(line, input.plans);
    if (!target) continue;
    const expectedHoursUsed = input.entitlementReads.get(`${target.table}:${target.id}`) ?? 0;
    entitlementLines.push({
      table: target.table,
      id: target.id,
      hours: roundHours(line.hours),
      expected_hours_used: roundHours(expectedHoursUsed),
    });
  }

  return {
    session_id: input.sessionId,
    user_id: input.userId,
    provider_destroyed_verified: input.providerDestroyedVerified === true,
    billing_close_verified: input.billingCloseVerified === true,
    expected_pre_settlement_status: input.expectedPreSettlementStatus,
    wallet_charge: walletCharge,
    entitlement_lines: entitlementLines,
    projection_sync: true,
    settlement_breakdown: input.breakdown,
    settlement_at: settlementAt,
    idempotency_key: idempotencyKey,
  };
}

/**
 * Translate the SCB 3.4A §4 response into the existing `SettlementResult`
 * shape. The OK/IDEMPOTENT branch preserves the fields callers depend on
 * (state, sessionId, settlementStatus, breakdown, billableSeconds,
 * chargedSeconds, walletCharge). The ERROR branch preserves the
 * (state, code, message) shape used by destroy-pipeline-run.js and
 * reconciliation.js.
 *
 * `billableSeconds` / `chargedSeconds` are JS-domain math (SCB 3.4A §4
 * explicitly excludes them from the RPC response); the caller passes the
 * JS-computed values in `jsContext` so the translated result carries them.
 *
 * @param {Record<string, unknown>} rpcResponse
 * @param {{
 *   sessionId: string;
 *   billableSeconds: number;
 *   chargedSeconds: number;
 *   breakdown: Record<string, unknown>|null;
 * }} jsContext
 * @returns {{
 *   state: 'OK'|'IDEMPOTENT'|'ERROR',
 *   sessionId: string,
 *   settlementStatus: string|null,
 *   breakdown: Record<string, unknown>|null,
 *   billableSeconds: number,
 *   chargedSeconds: number,
 *   walletCharge: number,
 *   code?: string,
 *   message?: string,
 *   rolledBack?: boolean,
 *   rpcState?: string
 * }}
 */
export function translateSettlementRpcResult(rpcResponse, jsContext) {
  const state = String(rpcResponse?.state ?? 'ERROR');

  if (state === 'OK' || state === 'IDEMPOTENT') {
    const settlementStatus = String(rpcResponse?.settlement_status ?? 'settled');
    const walletCharged = Number(rpcResponse?.wallet_charged ?? 0);
    return {
      state,
      sessionId: jsContext.sessionId,
      settlementStatus,
      breakdown: jsContext.breakdown ?? null,
      billableSeconds: jsContext.billableSeconds,
      chargedSeconds: jsContext.chargedSeconds,
      walletCharge: walletCharged,
      rpcState: state,
    };
  }

  // ERROR (SCB 3.4A §4 Recoverable Error shape).
  return {
    state: 'ERROR',
    sessionId: jsContext.sessionId,
    settlementStatus:
      rpcResponse?.settlement_status != null
        ? String(rpcResponse.settlement_status)
        : null,
    breakdown: jsContext.breakdown ?? null,
    billableSeconds: jsContext.billableSeconds,
    chargedSeconds: jsContext.chargedSeconds,
    walletCharge: 0,
    code: String(rpcResponse?.code ?? SETTLEMENT_RPC_ERROR.INTERNAL),
    message: String(rpcResponse?.message ?? 'settlement transaction failed'),
    rolledBack: rpcResponse?.rolled_back === true,
    rpcState: state,
  };
}

/**
 * Execute the settlement transaction RPC (SCB 3.4A §5).
 *
 * Contract:
 *   - All inputs are JS-prepared (allocation, breakdown, CAS reads).
 *   - The RPC is the atomic boundary T; this function performs NO
 *     settlement writes itself.
 *   - Returns the existing `SettlementResult` shape.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   sessionId: string;
 *   userId: string;
 *   providerDestroyedVerified: boolean;
 *   billingCloseVerified?: boolean;
 *   expectedPreSettlementStatus: string;
 *   lines: SettlementAllocationLine[];
 *   plans: Record<string, unknown>[];
 *   breakdown: Record<string, unknown>;
 *   billableSeconds: number;
 *   chargedSeconds: number;
 *   walletBalance: number;
 *   entitlementReads: Map<string, number>;
 *   settlementAt?: string;
 * }} input
 * @returns {Promise<Record<string, unknown>>}
 */
export async function executeSettlementTransaction(supabaseAdmin, input) {
  const payload = buildSettlementTransactionPayload({
    sessionId: input.sessionId,
    userId: input.userId,
    providerDestroyedVerified: input.providerDestroyedVerified,
    billingCloseVerified: input.billingCloseVerified,
    expectedPreSettlementStatus: input.expectedPreSettlementStatus,
    lines: input.lines,
    plans: input.plans,
    breakdown: input.breakdown,
    walletBalance: input.walletBalance,
    entitlementReads: input.entitlementReads,
    settlementAt: input.settlementAt,
  });

  const { data, error } = await supabaseAdmin.rpc('settle_session_transaction', {
    payload,
  });

  // supabase-js surfaces a Postgres function exception as `error` (no data).
  // This is the INTERNAL path (SCB 3.4A §4/§6): the function aborted for a
  // reason not captured by the structured ERROR return. rolled_back is
  // contractual — Postgres rolled the transaction back.
  if (error) {
    return translateSettlementRpcResult(
      {
        state: 'ERROR',
        code: SETTLEMENT_RPC_ERROR.INTERNAL,
        message: error.message ?? 'settle_session_transaction RPC errored',
        rolled_back: true,
        settlement_status: input.expectedPreSettlementStatus,
      },
      {
        sessionId: input.sessionId,
        billableSeconds: input.billableSeconds,
        chargedSeconds: input.chargedSeconds,
        breakdown: input.breakdown,
      },
    );
  }

  return translateSettlementRpcResult(
    data ?? { state: 'ERROR', code: SETTLEMENT_RPC_ERROR.INTERNAL, message: 'empty RPC response' },
    {
      sessionId: input.sessionId,
      billableSeconds: input.billableSeconds,
      chargedSeconds: input.chargedSeconds,
      breakdown: input.breakdown,
    },
  );
}
