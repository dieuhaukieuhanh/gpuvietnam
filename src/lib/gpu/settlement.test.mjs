import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SETTLEMENT_ERROR_CODE } from './settlement-core.js';
import { settleSession, skipSessionSettlement } from './settlement.js';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '22222222-2222-2222-2222-222222222222';

/**
 * @param {Record<string, unknown>} session
 * @param {Record<string, unknown>} [overrides]
 */
function closedSession(session, overrides = {}) {
  return {
    id: SESSION_ID,
    user_id: USER_ID,
    status: 'closed',
    started_at: '2026-01-01T10:00:00.000Z',
    ended_at: '2026-01-01T11:00:00.000Z',
    verified_destroyed_at: '2026-01-01T11:00:05.000Z',
    settlement_status: 'pending',
    settlement_at: null,
    settlement_breakdown: null,
    ...session,
    ...overrides,
  };
}

/**
 * @param {Record<string, unknown>} initial
 * @param {{
 *   plans?: Record<string, unknown>[];
 *   machines?: Record<string, unknown>[];
 *   walletBalance?: number;
 *   grants?: Record<string, unknown>[];
 *   subscriptions?: Record<string, unknown>[];
 * }} [options]
 */
function createMockSupabase(initial, options = {}) {
  /** @type {Record<string, unknown>} */
  const session = { ...initial };
  const plans = (options.plans ?? []).map((p) => ({ ...p }));
  let walletBalance = Number(options.walletBalance ?? 0);
  const grants = (options.grants ?? []).map((g) => ({ ...g }));
  const subscriptions = (options.subscriptions ?? []).map((s) => ({ ...s }));
  const machines = (options.machines ?? []).map((m) => ({ ...m }));
  /** @type {Record<string, unknown>[]} */
  const walletTx = [];

  return {
    session,
    plans,
    grants,
    subscriptions,
    machines,
    walletTx,
    walletBalance,
    client: {
      from(table) {
        const api = {
          _filters: /** @type {Record<string, unknown>} */ ({}),
          _inFilters: /** @type {Record<string, unknown[]>} */ ({}),
          _neq: /** @type {Record<string, unknown>} */ ({}),
          select() {
            return api;
          },
          eq(col, val) {
            api._filters[col] = val;
            return api;
          },
          neq(col, val) {
            api._neq[col] = val;
            return api;
          },
          in(col, vals) {
            api._inFilters[col] = vals;
            return api;
          },
          maybeSingle() {
            return Promise.resolve({ data: this._resolveOne(), error: null });
          },
          single() {
            const data = this._resolveOne();
            return Promise.resolve({ data, error: data ? null : { message: 'not found' } });
          },
          _resolveOne() {
            if (table === 'gpu_sessions') {
              if (api._filters.id && api._filters.id !== session.id) return null;
              if (api._filters.user_id && api._filters.user_id !== session.user_id) return null;
              return { ...session };
            }
            if (table === 'machines') {
              return (
                machines.find((m) => {
                  if (api._filters.id && String(m.id) !== String(api._filters.id)) return false;
                  if (
                    api._filters.gpu_session_id &&
                    String(m.gpu_session_id) !== String(api._filters.gpu_session_id)
                  ) {
                    return false;
                  }
                  return true;
                }) ?? null
              );
            }
            if (table === 'users') {
              return { wallet_balance: walletBalance };
            }
            if (table === 'manual_hour_grants') {
              return grants.find((g) => g.id === api._filters.id) ?? null;
            }
            if (table === 'subscriptions') {
              return subscriptions.find((s) => s.id === api._filters.id) ?? null;
            }
            if (table === 'wallet_transactions') {
              return (
                walletTx.find(
                  (tx) =>
                    tx.user_id === api._filters.user_id &&
                    tx.description === api._filters.description,
                ) ?? null
              );
            }
            return null;
          },
          update(payload) {
            const filters = { ...api._filters };
            const inFilters = { ...api._inFilters };
            const neq = { ...api._neq };
            return {
              eq(col, val) {
                filters[col] = val;
                return {
                  eq(col2, val2) {
                    filters[col2] = val2;
                    return buildInChain();
                  },
                  in(col3, vals) {
                    inFilters[col3] = vals;
                    return buildInChain();
                  },
                  neq(col2, val2) {
                    if (session[col2] === val2) {
                      return { then: (r) => Promise.resolve(r({ error: null })) };
                    }
                    return applySessionUpdate();
                  },
                  then(resolve) {
                    return applySessionUpdate().then(resolve);
                  },
                };
              },
            };

            function buildInChain() {
              return {
                in(col, vals) {
                  inFilters[col] = vals;
                  return {
                    in(col2, vals2) {
                      inFilters[col2] = vals2;
                      return buildSelectChain();
                    },
                    select() {
                      return buildSelectChain();
                    },
                    then(resolve) {
                      return applySessionUpdate().then(resolve);
                    },
                  };
                },
                select() {
                  return buildSelectChain();
                },
                neq(col, val) {
                  if (session[col] === val) {
                    return { then: (r) => Promise.resolve(r({ error: null })) };
                  }
                  return applySessionUpdate();
                },
                then(resolve) {
                  return applySessionUpdate().then(resolve);
                },
              };
            }

            function buildSelectChain() {
              return {
                select() {
                  return {
                    maybeSingle() {
                      return applySessionUpdate();
                    },
                  };
                },
                eq(col, val) {
                  filters[col] = val;
                  return buildSelectChain();
                },
                neq(col, val) {
                  if (session[col] === val) {
                    return { then: (r) => Promise.resolve(r({ error: null })) };
                  }
                  return applySessionUpdate();
                },
                then(resolve) {
                  return applySessionUpdate().then(resolve);
                },
              };
            }

            function applySessionUpdate() {
              if (table === 'gpu_sessions') {
                if (filters.id && filters.id !== session.id) {
                  return Promise.resolve({ data: null, error: null });
                }
                if (filters.user_id && filters.user_id !== session.user_id) {
                  return Promise.resolve({ data: null, error: null });
                }
                if (inFilters.status && !inFilters.status.includes(session.status)) {
                  return Promise.resolve({ data: null, error: null });
                }
                if (
                  inFilters.settlement_status &&
                  !inFilters.settlement_status.includes(session.settlement_status)
                ) {
                  return Promise.resolve({ data: null, error: null });
                }
                if (filters.settlement_status && session.settlement_status !== filters.settlement_status) {
                  return Promise.resolve({ data: null, error: null });
                }
                if (neq.settlement_status && session.settlement_status === neq.settlement_status) {
                  return Promise.resolve({ error: null });
                }
                Object.assign(session, payload);
                return Promise.resolve({ data: { id: session.id }, error: null });
              }
              if (table === 'users') {
                if (payload.wallet_balance != null) {
                  walletBalance = Number(payload.wallet_balance);
                }
                return Promise.resolve({ error: null });
              }
              if (table === 'manual_hour_grants') {
                const grant = grants.find((g) => g.id === filters.id);
                if (grant && payload.hours_used != null) {
                  grant.hours_used = payload.hours_used;
                }
                return Promise.resolve({ error: null });
              }
              if (table === 'subscriptions') {
                const sub = subscriptions.find((s) => s.id === filters.id);
                if (sub && payload.hours_used != null) {
                  sub.hours_used = payload.hours_used;
                }
                return Promise.resolve({ error: null });
              }
              return Promise.resolve({ error: null });
            }
          },
          insert(row) {
            if (table === 'wallet_transactions') {
              walletTx.push({ ...row });
            }
            return Promise.resolve({ error: null });
          },
          then(resolve) {
            if (table === 'user_plan_inventory') {
              const rows = plans.filter((p) => {
                if (api._filters.user_id && p.user_id !== api._filters.user_id) return false;
                if (api._filters.status && p.status !== api._filters.status) return false;
                return true;
              });
              return Promise.resolve(resolve({ data: rows, error: null }));
            }
            return Promise.resolve(resolve({ data: null, error: null }));
          },
        };
        return api;
      },
      /**
       * SCB 3.4B — mock of the server-side `settle_session_transaction` RPC.
       * Applies the W2–W7 unit atomically against the in-memory mock state,
       * returning the SCB 3.4A §4 response shape. Mirrors the real PL/pgSQL
       * function's claim guard, wallet CAS + ledger idempotency, entitlement
       * CAS, projection re-derive, and finalize.
       */
      async rpc(name, args) {
        if (name !== 'settle_session_transaction') {
          return { data: null, error: { message: `unknown rpc ${name}` } };
        }
        /** @param {number} v */
        const round2 = (v) => Math.round(Number(v) * 100) / 100;
        const p = args.payload;
        const pSessionId = p.session_id;
        const pUserId = p.user_id;
        const pExpectedPre = p.expected_pre_settlement_status;
        const pWallet = p.wallet_charge;
        /** @type {Array<Record<string, unknown>>} */
        const pLines = Array.isArray(p.entitlement_lines) ? p.entitlement_lines : [];
        const pBreakdown = p.settlement_breakdown ?? null;
        const pSettlementAt = p.settlement_at ?? new Date().toISOString();
        const pIdempotencyKey = p.idempotency_key ?? null;

        // STEP 1 — CLAIM (W2)
        if (String(session.id) !== String(pSessionId)) {
          return { data: { state: 'ERROR', code: 'CLAIM_PRECONDITION', message: 'session not found', rolled_back: true, settlement_status: null }, error: null };
        }
        if (String(session.user_id) !== String(pUserId)) {
          return { data: { state: 'ERROR', code: 'CLAIM_PRECONDITION', message: 'user mismatch', rolled_back: true, settlement_status: session.settlement_status }, error: null };
        }
        if (session.status !== 'closed' && session.status !== 'completed') {
          return { data: { state: 'ERROR', code: 'CLAIM_PRECONDITION', message: 'not closed', rolled_back: true, settlement_status: session.settlement_status }, error: null };
        }
        if (session.settlement_status !== pExpectedPre) {
          return { data: { state: 'ERROR', code: 'CLAIM_LOST', message: 'settlement_status mismatch', rolled_back: true, settlement_status: session.settlement_status }, error: null };
        }
        session.settlement_status = 'in_progress';

        // STEP 2 — WALLET (W3 + W4)
        let walletCharged = 0;
        if (pWallet && Number(pWallet.amount) > 0) {
          const amount = Number(pWallet.amount);
          if (pIdempotencyKey && walletTx.some((tx) => tx.idempotency_key === pIdempotencyKey)) {
            session.settlement_status = pExpectedPre; // rollback
            return { data: { state: 'ERROR', code: 'LEDGER_CONFLICT', message: 'ledger dup', rolled_back: true, settlement_status: pExpectedPre }, error: null };
          }
          walletBalance = Math.max(0, walletBalance - amount);
          walletTx.push({
            user_id: pUserId,
            type: 'payment',
            amount,
            bonus_amount: 0,
            balance_after: Number(pWallet.balance_after),
            description: pWallet.description,
            status: 'completed',
            created_at: pSettlementAt,
            idempotency_key: pIdempotencyKey,
          });
          walletCharged = amount;
        }

        // STEP 3 — ENTITLEMENT (W5), per line CAS
        /** @type {Array<Record<string, unknown>>} */
        const consumed = [];
        for (const line of pLines) {
          if (Number(line.hours) <= 0) {
            consumed.push({ table: line.table, id: line.id, hours: 0, final_hours_used: null });
            continue;
          }
          const store = line.table === 'manual_hour_grants' ? grants : subscriptions;
          const row = store.find((r) => String(r.id) === String(line.id));
          if (!row) {
            session.settlement_status = pExpectedPre; // rollback
            return { data: { state: 'ERROR', code: 'CLAIM_PRECONDITION', message: 'entitlement row not found', rolled_back: true, settlement_status: pExpectedPre }, error: null };
          }
          const current = Number(row.hours_used ?? 0);
          // CAS: use expected_hours_used on first attempt; if mismatch (concurrent
          // writer), fall back to current (mirrors server retry-success).
          const base = current === Number(line.expected_hours_used) ? Number(line.expected_hours_used) : current;
          const next = round2(base + Number(line.hours));
          row.hours_used = next;
          consumed.push({ table: line.table, id: line.id, hours: Number(line.hours), final_hours_used: next });
        }

        // STEP 4 — PROJECTION SYNC (W6): re-derive hours_remaining on plans.
        for (const plan of plans) {
          if (plan.grant_id != null) {
            const g = grants.find((r) => String(r.id) === String(plan.grant_id));
            if (g) {
              const remaining = Math.max(0, Number(g.hours_granted ?? 0) - Number(g.hours_used ?? 0));
              plan.hours_remaining = round2(remaining);
              plan.status = remaining <= 0 ? 'depleted' : 'active';
            }
            continue;
          }
          if (plan.subscription_id != null) {
            const s = subscriptions.find((r) => String(r.id) === String(plan.subscription_id));
            if (s) {
              const remaining = Math.max(0, Number(s.hours_total ?? 0) - Number(s.hours_used ?? 0));
              plan.hours_remaining = round2(remaining);
              plan.status = remaining <= 0 && s.billing !== 'hourly' ? 'depleted' : 'active';
            }
          }
        }

        // STEP 5 — FINALIZE (W7)
        session.settlement_status = 'settled';
        session.settlement_at = pSettlementAt;
        session.settlement_breakdown = pBreakdown;

        return {
          data: {
            state: 'OK',
            session_id: pSessionId,
            settlement_status: 'settled',
            settlement_at: pSettlementAt,
            wallet_charged: walletCharged,
            entitlement_consumed: consumed,
            projection_synced: true,
            attempts: { claim: 1, entitlement_lines: pLines.map(() => 1) },
          },
          error: null,
        };
      },
    },
  };
}

describe('settleSession', () => {
  it('T1 — 3600s session with gift entitlement settles', async () => {
    const mock = createMockSupabase(closedSession({}), {
      plans: [
        {
          id: 1,
          user_id: USER_ID,
          plan_type: 'gift',
          plan_name: 'gift',
          hours_remaining: 10,
          status: 'active',
        },
      ],
      walletBalance: 0,
    });

    const result = await settleSession(
      mock.client,
      { sessionId: SESSION_ID, userId: USER_ID, providerDestroyedVerified: true },
    );

    assert.equal(result.state, 'OK');
    assert.equal(mock.session.settlement_status, 'settled');
    assert.equal(mock.session.settlement_breakdown?.billable_seconds, 3600);
    assert.equal(mock.session.settlement_breakdown?.gift?.hours, 1);
  });

  it('T2 — idempotent on second settle', async () => {
    const mock = createMockSupabase(
      closedSession({
        settlement_status: 'settled',
        settlement_at: '2026-01-01T11:01:00.000Z',
        settlement_breakdown: { billable_seconds: 3600, charged_seconds: 3600, gift: { hours: 1 } },
      }),
      {
        plans: [
          {
            id: 1,
            user_id: USER_ID,
            plan_type: 'gift',
            hours_remaining: 9,
            status: 'active',
          },
        ],
      },
    );

    const result = await settleSession(
      mock.client,
      { sessionId: SESSION_ID, userId: USER_ID, providerDestroyedVerified: true },
    );

    assert.equal(result.state, 'IDEMPOTENT');
    assert.equal(mock.grants.length, 0);
    assert.equal(mock.walletTx.length, 0);
  });

  it('T3 — rejects when verify not destroyed', async () => {
    const mock = createMockSupabase(
      closedSession({ verified_destroyed_at: null, settlement_status: 'awaiting_verify' }),
      { plans: [] },
    );

    const result = await settleSession(mock.client, {
      sessionId: SESSION_ID,
      userId: USER_ID,
      providerDestroyedVerified: false,
    });

    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SETTLEMENT_ERROR_CODE.VERIFY_NOT_DESTROYED);
    assert.equal(mock.session.settlement_status, 'awaiting_verify');
  });

  it('T4 — skipSessionSettlement skips without entitlement change', async () => {
    const mock = createMockSupabase(closedSession({ settlement_status: 'pending' }), {
      plans: [{ id: 1, user_id: USER_ID, plan_type: 'gift', hours_remaining: 10, status: 'active' }],
    });

    const result = await skipSessionSettlement(mock.client, SESSION_ID, 'admin_waive', {
      userId: USER_ID,
    });

    assert.equal(result.state, 'SKIPPED');
    assert.equal(mock.session.settlement_status, 'skipped');
    assert.equal(mock.walletTx.length, 0);
  });

  it('T8 — zero billable auto-skips', async () => {
    const mock = createMockSupabase(
      closedSession({
        started_at: '2026-01-01T10:00:00.000Z',
        ended_at: '2026-01-01T10:00:00.000Z',
      }),
      { plans: [] },
    );

    const result = await settleSession(
      mock.client,
      { sessionId: SESSION_ID, userId: USER_ID, providerDestroyedVerified: true },
    );

    assert.equal(result.state, 'SKIPPED');
    assert.equal(mock.session.settlement_status, 'skipped');
  });

  it('T7 — second settle after committed T returns IDEMPOTENT (no double debit) [SCB 3.4 §7]', async () => {
    const mock = createMockSupabase(closedSession({ settlement_status: 'failed' }), {
      plans: [
        {
          id: 1,
          user_id: USER_ID,
          plan_type: 'hourly',
          plan_name: 'hourly',
          price_per_hour: 10000,
          status: 'active',
        },
      ],
      walletBalance: 20000,
    });

    // First call: T commits atomically. status -> settled, exactly one ledger row.
    const first = await settleSession(
      mock.client,
      { sessionId: SESSION_ID, userId: USER_ID, providerDestroyedVerified: true },
    );
    assert.equal(first.state, 'OK');
    assert.equal(mock.session.settlement_status, 'settled');
    assert.equal(mock.walletTx.length, 1);

    // Second call: SCB 3.4 §7 — settlement_status='settled' hits the JS
    // idempotency fast path (and would hit the RPC claim guard if it didn't).
    // No second debit, no second ledger row.
    const retry = await settleSession(
      mock.client,
      { sessionId: SESSION_ID, userId: USER_ID, providerDestroyedVerified: true },
    );
    assert.equal(retry.state, 'IDEMPOTENT');
    assert.equal(mock.walletTx.length, 1);
  });

  it('rejects when session still running', async () => {
    const mock = createMockSupabase(
      closedSession({ status: 'running', settlement_status: 'awaiting_verify' }),
      { plans: [] },
    );

    const result = await settleSession(mock.client, {
      sessionId: SESSION_ID,
      userId: USER_ID,
      providerDestroyedVerified: true,
    });

    assert.equal(result.code, SETTLEMENT_ERROR_CODE.SESSION_NOT_CLOSED);
  });

  it('burns only the session package — Pro does not consume Starter gift', async () => {
    const MACHINE_ID = '33333333-3333-3333-3333-333333333333';
    const PRO_SUB = '44444444-4444-4444-4444-444444444444';
    const mock = createMockSupabase(
      closedSession({ machine_id: MACHINE_ID }),
      {
        machines: [
          {
            id: MACHINE_ID,
            gpu_line: 'rtx4090_1x',
            billing_inventory_id: 21,
            subscription_id: PRO_SUB,
            gpu_session_id: SESSION_ID,
          },
        ],
        plans: [
          {
            id: 15,
            user_id: USER_ID,
            plan_type: 'gift',
            plan_name: 'starter',
            hours_remaining: 10,
            status: 'active',
          },
          {
            id: 21,
            user_id: USER_ID,
            plan_type: 'combo',
            plan_name: 'pro',
            billing: 'combo2',
            hours_remaining: 230,
            subscription_id: PRO_SUB,
            status: 'active',
          },
        ],
        subscriptions: [{ id: PRO_SUB, hours_total: 230, hours_used: 0, billing: 'combo2' }],
        walletBalance: 0,
      },
    );

    const result = await settleSession(mock.client, {
      sessionId: SESSION_ID,
      userId: USER_ID,
      providerDestroyedVerified: true,
    });

    assert.equal(result.state, 'OK');
    assert.equal(result.sessionId, SESSION_ID);
    assert.equal(mock.session.settlement_breakdown?.combo?.hours, 1);
    assert.equal(mock.session.settlement_breakdown?.gift?.hours ?? 0, 0);
    assert.equal(Number(mock.subscriptions[0].hours_used), 1);
    assert.equal(Number(mock.plans.find((p) => p.id === 15)?.hours_remaining), 10);
  });
});
