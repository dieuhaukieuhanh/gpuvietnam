import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SETTLEMENT_RPC_ERROR,
  isSettlementRpcRetryable,
  readCasGuardValues,
  buildSettlementTransactionPayload,
  translateSettlementRpcResult,
  executeSettlementTransaction,
} from './settlement-transaction-rpc.js';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '22222222-2222-2222-2222-222222222222';
const GRANT_ID = 101;
const SUB_ID = 'sub-1';

/**
 * Minimal supabase-js mock for the RPC wrapper. `rpcResponses` is a queue
 * of `{ data, error }` returned in call order for any `settle_session_transaction`
 * invocation; `rpcCalls` captures every payload sent.
 */
function createRpcMock({ walletBalance = 0, grantHoursUsed = 0, subHoursUsed = 0 } = {}) {
  /** @type {Array<{ data: Record<string, unknown>|null, error: { message: string }|null }>} */
  const rpcResponses = [];
  /** @type {Array<Record<string, unknown>>} */
  const rpcCalls = [];

  const grants = [{ id: GRANT_ID, hours_used: grantHoursUsed }];
  const subscriptions = [{ id: SUB_ID, hours_used: subHoursUsed }];

  const client = {
    async rpc(name, args) {
      if (name !== 'settle_session_transaction') {
        return { data: null, error: { message: `unknown rpc ${name}` } };
      }
      rpcCalls.push(args.payload);
      return rpcResponses.shift() ?? { data: null, error: { message: 'no queued response' } };
    },
    from(table) {
      const api = {
        _filters: /** @type {Record<string, unknown>} */ ({}),
        select() {
          return api;
        },
        eq(col, val) {
          api._filters[col] = val;
          return api;
        },
        maybeSingle() {
          if (table === 'users') {
            return Promise.resolve({ data: { wallet_balance: walletBalance }, error: null });
          }
          if (table === 'manual_hour_grants') {
            const row = grants.find((g) => String(g.id) === String(api._filters.id));
            return Promise.resolve({ data: row ? { hours_used: row.hours_used } : null, error: null });
          }
          if (table === 'subscriptions') {
            const row = subscriptions.find((s) => String(s.id) === String(api._filters.id));
            return Promise.resolve({ data: row ? { hours_used: row.hours_used } : null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return api;
    },
  };

  return { client, rpcCalls, queue: rpcResponses, grants, subscriptions };
}

describe('SETTLEMENT_RPC_ERROR / isSettlementRpcRetryable', () => {
  it('classifies WALLET_CAS / CAS_EXHAUSTED / PROJECTION_FAILED / INTERNAL as retryable (SCB 3.4A §9)', () => {
    assert.equal(isSettlementRpcRetryable(SETTLEMENT_RPC_ERROR.WALLET_CAS), true);
    assert.equal(isSettlementRpcRetryable(SETTLEMENT_RPC_ERROR.CAS_EXHAUSTED), true);
    assert.equal(isSettlementRpcRetryable(SETTLEMENT_RPC_ERROR.PROJECTION_FAILED), true);
    assert.equal(isSettlementRpcRetryable(SETTLEMENT_RPC_ERROR.INTERNAL), true);
  });

  it('classifies CLAIM_LOST / CLAIM_PRECONDITION / LEDGER_CONFLICT as NOT blind-retryable', () => {
    assert.equal(isSettlementRpcRetryable(SETTLEMENT_RPC_ERROR.CLAIM_LOST), false);
    assert.equal(isSettlementRpcRetryable(SETTLEMENT_RPC_ERROR.CLAIM_PRECONDITION), false);
    assert.equal(isSettlementRpcRetryable(SETTLEMENT_RPC_ERROR.LEDGER_CONFLICT), false);
  });
});

describe('readCasGuardValues (SCB 3.4A §9 pre-RPC reads)', () => {
  it('reads wallet_balance and per-entitlement hours_used outside T', async () => {
    const mock = createRpcMock({ walletBalance: 50000, grantHoursUsed: 2 });
    const lines = [
      { source: 'manual_grant', seconds: 3600, hours: 1, grantId: GRANT_ID, subscriptionId: null, inventoryId: 1 },
      { source: 'wallet', seconds: 3600, hours: 1, inventoryId: 2, walletVnd: 10000, pricePerHour: 10000 },
    ];
    const plans = [
      { id: 1, plan_type: 'gift', grant_id: GRANT_ID, hours_remaining: 10, status: 'active' },
      { id: 2, plan_type: 'hourly', subscription_id: null, price_per_hour: 10000, status: 'active' },
    ];

    const { walletBalance, entitlementReads } = await readCasGuardValues(mock.client, USER_ID, lines, plans);

    assert.equal(walletBalance, 50000);
    assert.equal(entitlementReads.get(`manual_hour_grants:${GRANT_ID}`), 2);
    // wallet lines are not entitlement reads
    assert.equal(entitlementReads.has('subscriptions:null'), false);
  });

  it('deduplicates entitlement reads by table:id', async () => {
    const mock = createRpcMock({ grantHoursUsed: 3 });
    const lines = [
      { source: 'manual_grant', hours: 1, grantId: GRANT_ID, subscriptionId: null },
      { source: 'manual_grant', hours: 1, grantId: GRANT_ID, subscriptionId: null },
    ];
    const plans = [{ id: 1, grant_id: GRANT_ID, status: 'active' }];

    const { entitlementReads } = await readCasGuardValues(mock.client, USER_ID, lines, plans);
    assert.equal(entitlementReads.size, 1);
    assert.equal(entitlementReads.get(`manual_hour_grants:${GRANT_ID}`), 3);
  });
});

describe('buildSettlementTransactionPayload (SCB 3.4A §3 input contract)', () => {
  it('builds wallet_charge from wallet lines, clamped to balance, with legacy description format', () => {
    const lines = [
      { source: 'wallet', seconds: 3600, hours: 1, inventoryId: 2, walletVnd: 10000, pricePerHour: 10000 },
    ];
    const plans = [
      { id: 2, plan_type: 'hourly', plan_name: 'hourly', price_per_hour: 10000, status: 'active' },
    ];
    const entitlementReads = new Map();
    const breakdown = { billable_seconds: 3600, charged_seconds: 3600 };

    const payload = buildSettlementTransactionPayload({
      sessionId: SESSION_ID,
      userId: USER_ID,
      providerDestroyedVerified: true,
      expectedPreSettlementStatus: 'pending',
      lines,
      plans,
      breakdown,
      walletBalance: 50000,
      entitlementReads,
      settlementAt: '2026-07-04T00:00:00.000Z',
    });

    assert.equal(payload.session_id, SESSION_ID);
    assert.equal(payload.user_id, USER_ID);
    assert.equal(payload.provider_destroyed_verified, true);
    assert.equal(payload.expected_pre_settlement_status, 'pending');
    assert.equal(payload.projection_sync, true);
    assert.equal(payload.settlement_at, '2026-07-04T00:00:00.000Z');
    assert.equal(payload.idempotency_key, `settle:${SESSION_ID}`);
    assert.equal(payload.settlement_breakdown, breakdown);

    assert.ok(payload.wallet_charge);
    assert.equal(payload.wallet_charge.amount, 10000);
    assert.equal(payload.wallet_charge.balance_after, 40000);
    assert.match(
      payload.wallet_charge.description,
      new RegExp(`GPU session ${SESSION_ID} · 1h · hourly`),
    );
    assert.deepEqual(payload.entitlement_lines, []);
  });

  it('clamps wallet charge to balance (preserves legacy Math.min(balance, charge))', () => {
    const lines = [
      { source: 'wallet', hours: 10, inventoryId: 2, walletVnd: 100000, pricePerHour: 10000 },
    ];
    const plans = [{ id: 2, plan_type: 'hourly', plan_name: 'hourly', price_per_hour: 10000, status: 'active' }];

    const payload = buildSettlementTransactionPayload({
      sessionId: SESSION_ID,
      userId: USER_ID,
      providerDestroyedVerified: true,
      expectedPreSettlementStatus: 'pending',
      lines,
      plans,
      breakdown: {},
      walletBalance: 30000,
      entitlementReads: new Map(),
    });

    // Clamped to walletBalance; balance_after floored at 0.
    assert.equal(payload.wallet_charge.amount, 30000);
    assert.equal(payload.wallet_charge.balance_after, 0);
  });

  it('sets wallet_charge=null when no wallet line', () => {
    const lines = [
      { source: 'manual_grant', hours: 1, grantId: GRANT_ID, subscriptionId: null },
    ];
    const plans = [{ id: 1, grant_id: GRANT_ID, status: 'active' }];

    const payload = buildSettlementTransactionPayload({
      sessionId: SESSION_ID,
      userId: USER_ID,
      providerDestroyedVerified: true,
      expectedPreSettlementStatus: 'pending',
      lines,
      plans,
      breakdown: {},
      walletBalance: 0,
      entitlementReads: new Map([[`manual_hour_grants:${GRANT_ID}`, 2]]),
    });

    assert.equal(payload.wallet_charge, null);
    assert.equal(payload.entitlement_lines.length, 1);
    assert.equal(payload.entitlement_lines[0].table, 'manual_hour_grants');
    assert.equal(payload.entitlement_lines[0].id, GRANT_ID);
    assert.equal(payload.entitlement_lines[0].hours, 1);
    assert.equal(payload.entitlement_lines[0].expected_hours_used, 2);
  });

  it('maps combo lines to subscriptions table', () => {
    const lines = [
      { source: 'combo', hours: 2, grantId: null, subscriptionId: SUB_ID, inventoryId: 3 },
    ];
    const plans = [{ id: 3, plan_type: 'combo', subscription_id: SUB_ID, status: 'active' }];

    const payload = buildSettlementTransactionPayload({
      sessionId: SESSION_ID,
      userId: USER_ID,
      providerDestroyedVerified: true,
      expectedPreSettlementStatus: 'failed',
      lines,
      plans,
      breakdown: {},
      walletBalance: 0,
      entitlementReads: new Map([[`subscriptions:${SUB_ID}`, 4]]),
    });

    assert.equal(payload.entitlement_lines[0].table, 'subscriptions');
    assert.equal(payload.entitlement_lines[0].id, SUB_ID);
    assert.equal(payload.entitlement_lines[0].expected_hours_used, 4);
  });
});

describe('translateSettlementRpcResult (SCB 3.4A §4 → SettlementResult)', () => {
  const jsContext = { sessionId: SESSION_ID, billableSeconds: 3600, chargedSeconds: 3600, breakdown: { charged_seconds: 3600 } };

  it('OK → SettlementResult OK preserving all JS-domain fields', () => {
    const result = translateSettlementRpcResult(
      { state: 'OK', session_id: SESSION_ID, settlement_status: 'settled', settlement_at: '2026-07-04T00:00:00.000Z', wallet_charged: 10000, entitlement_consumed: [], projection_synced: true },
      jsContext,
    );
    assert.equal(result.state, 'OK');
    assert.equal(result.sessionId, SESSION_ID);
    assert.equal(result.settlementStatus, 'settled');
    assert.equal(result.billableSeconds, 3600);
    assert.equal(result.chargedSeconds, 3600);
    assert.equal(result.walletCharge, 10000);
    assert.equal(result.breakdown, jsContext.breakdown);
  });

  it('IDEMPOTENT → SettlementResult IDEMPOTENT', () => {
    const result = translateSettlementRpcResult(
      { state: 'IDEMPOTENT', session_id: SESSION_ID, settlement_status: 'settled', settlement_at: '2026-07-04T00:00:00.000Z', wallet_charged: 0, entitlement_consumed: [], projection_synced: true },
      jsContext,
    );
    assert.equal(result.state, 'IDEMPOTENT');
    assert.equal(result.settlementStatus, 'settled');
  });

  it('ERROR CLAIM_LOST → SettlementResult ERROR with rolled_back=true', () => {
    const result = translateSettlementRpcResult(
      { state: 'ERROR', code: 'CLAIM_LOST', message: 'rival won', rolled_back: true, settlement_status: 'pending' },
      jsContext,
    );
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SETTLEMENT_RPC_ERROR.CLAIM_LOST);
    assert.equal(result.message, 'rival won');
    assert.equal(result.rolledBack, true);
    assert.equal(result.settlementStatus, 'pending');
  });

  it('ERROR with missing code defaults to INTERNAL', () => {
    const result = translateSettlementRpcResult({ state: 'ERROR', message: 'boom' }, jsContext);
    assert.equal(result.code, SETTLEMENT_RPC_ERROR.INTERNAL);
  });
});

describe('executeSettlementTransaction (end-to-end wrapper)', () => {
  it('invokes the RPC with the assembled payload and returns SettlementResult OK', async () => {
    const mock = createRpcMock({ walletBalance: 50000, grantHoursUsed: 0 });
    mock.queue.push({
      data: {
        state: 'OK',
        session_id: SESSION_ID,
        settlement_status: 'settled',
        settlement_at: '2026-07-04T00:00:00.000Z',
        wallet_charged: 10000,
        entitlement_consumed: [{ table: 'manual_hour_grants', id: GRANT_ID, hours: 1, final_hours_used: 1 }],
        projection_synced: true,
      },
      error: null,
    });

    const lines = [
      { source: 'manual_grant', hours: 1, grantId: GRANT_ID, subscriptionId: null },
      { source: 'wallet', hours: 1, inventoryId: 2, walletVnd: 10000, pricePerHour: 10000 },
    ];
    const plans = [
      { id: 1, grant_id: GRANT_ID, status: 'active' },
      { id: 2, plan_type: 'hourly', plan_name: 'hourly', price_per_hour: 10000, status: 'active' },
    ];

    const result = await executeSettlementTransaction(mock.client, {
      sessionId: SESSION_ID,
      userId: USER_ID,
      providerDestroyedVerified: true,
      expectedPreSettlementStatus: 'pending',
      lines,
      plans,
      breakdown: { charged_seconds: 7200 },
      billableSeconds: 7200,
      chargedSeconds: 7200,
      walletBalance: 50000,
      entitlementReads: new Map([[`manual_hour_grants:${GRANT_ID}`, 0]]),
      settlementAt: '2026-07-04T00:00:00.000Z',
    });

    assert.equal(result.state, 'OK');
    assert.equal(result.sessionId, SESSION_ID);
    assert.equal(result.settlementStatus, 'settled');
    assert.equal(result.walletCharge, 10000);
    assert.equal(result.billableSeconds, 7200);
    // payload sent to the RPC carries the §3 fields
    assert.equal(mock.rpcCalls.length, 1);
    assert.equal(mock.rpcCalls[0].session_id, SESSION_ID);
    assert.equal(mock.rpcCalls[0].expected_pre_settlement_status, 'pending');
    assert.equal(mock.rpcCalls[0].idempotency_key, `settle:${SESSION_ID}`);
  });

  it('translates a supabase-js error into ERROR INTERNAL with rolled_back=true', async () => {
    const mock = createRpcMock();
    mock.queue.push({ data: null, error: { message: 'connection lost' } });

    const result = await executeSettlementTransaction(mock.client, {
      sessionId: SESSION_ID,
      userId: USER_ID,
      providerDestroyedVerified: true,
      expectedPreSettlementStatus: 'pending',
      lines: [],
      plans: [],
      breakdown: {},
      billableSeconds: 0,
      chargedSeconds: 0,
      walletBalance: 0,
      entitlementReads: new Map(),
    });

    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SETTLEMENT_RPC_ERROR.INTERNAL);
    assert.equal(result.rolledBack, true);
    assert.match(result.message, /connection lost/);
  });

  it('passes expected_hours_used from the JS CAS read into each entitlement line', async () => {
    const mock = createRpcMock({ grantHoursUsed: 7 });
    mock.queue.push({
      data: { state: 'OK', session_id: SESSION_ID, settlement_status: 'settled', settlement_at: 'now', wallet_charged: 0, entitlement_consumed: [], projection_synced: true },
      error: null,
    });

    const lines = [{ source: 'manual_grant', hours: 2, grantId: GRANT_ID, subscriptionId: null }];
    const plans = [{ id: 1, grant_id: GRANT_ID, status: 'active' }];

    await executeSettlementTransaction(mock.client, {
      sessionId: SESSION_ID,
      userId: USER_ID,
      providerDestroyedVerified: true,
      expectedPreSettlementStatus: 'pending',
      lines,
      plans,
      breakdown: {},
      billableSeconds: 7200,
      chargedSeconds: 7200,
      walletBalance: 0,
      entitlementReads: new Map([[`manual_hour_grants:${GRANT_ID}`, 7]]),
    });

    assert.equal(mock.rpcCalls[0].entitlement_lines[0].expected_hours_used, 7);
  });
});
