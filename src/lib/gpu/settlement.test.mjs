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
  /** @type {Record<string, unknown>[]} */
  const walletTx = [];

  const syncInventory = async () => plans;

  return {
    session,
    plans,
    grants,
    subscriptions,
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
    },
    syncInventory,
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
      { syncUserPlanInventory: mock.syncInventory },
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
      { syncUserPlanInventory: mock.syncInventory },
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
      { syncUserPlanInventory: mock.syncInventory },
    );

    assert.equal(result.state, 'SKIPPED');
    assert.equal(mock.session.settlement_status, 'skipped');
  });

  it('T7 — retry from failed does not duplicate wallet tx', async () => {
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

    const first = await settleSession(
      mock.client,
      { sessionId: SESSION_ID, userId: USER_ID, providerDestroyedVerified: true },
      { syncUserPlanInventory: mock.syncInventory },
    );
    assert.equal(first.state, 'OK');
    assert.equal(mock.walletTx.length, 1);

    mock.session.settlement_status = 'failed';
    const retry = await settleSession(
      mock.client,
      { sessionId: SESSION_ID, userId: USER_ID, providerDestroyedVerified: true },
      { syncUserPlanInventory: mock.syncInventory },
    );
    assert.equal(retry.state, 'OK');
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
});
