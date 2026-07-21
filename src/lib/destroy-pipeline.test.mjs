import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DESTROY_PIPELINE_OUTCOME,
  DESTROY_PIPELINE_STEP,
  assertSettlementAfterVerify,
} from './destroy-pipeline-core.js';
import { runDestroyPipeline } from './destroy-pipeline-run.js';
import {
  PROVIDER_VERIFY_STATE,
  PROVIDER_VERIFY_OUTCOME,
} from './gpu/provider-verify.js';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '22222222-2222-2222-2222-222222222222';
const MACHINE_ID = '33333333-3333-3333-3333-333333333333';
const INSTANCE_ID = '44444';

function runningMachine(overrides = {}) {
  return {
    id: MACHINE_ID,
    user_id: USER_ID,
    instance_id: INSTANCE_ID,
    status: 'running',
    ip_address: '10.0.0.1',
    port: 8188,
    gpu_session_id: SESSION_ID,
    billing_started_at: '2026-01-01T10:00:00.000Z',
    created_at: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

function runningSession() {
  return {
    id: SESSION_ID,
    user_id: USER_ID,
    machine_id: MACHINE_ID,
    status: 'running',
    started_at: '2026-01-01T10:00:00.000Z',
    ended_at: null,
    settlement_status: null,
    destroy_reason: null,
    verified_destroyed_at: null,
  };
}

/**
 * @param {Record<string, unknown>} initialSession
 * @param {Record<string, unknown>} [initialMachine]
 */
function createMockSupabase(initialSession, initialMachine = runningMachine()) {
  /** @type {Record<string, unknown>} */
  const session = { ...initialSession };
  /** @type {Record<string, unknown>} */
  const machine = { ...initialMachine };

  return {
    session,
    machine,
    client: {
      from(table) {
        const api = {
          _eq: /** @type {Record<string, unknown>} */ ({}),
          select() {
            return api;
          },
          eq(col, val) {
            api._eq[col] = val;
            return api;
          },
          in() {
            return api;
          },
          order() {
            return api;
          },
          limit() {
            return api;
          },
          maybeSingle() {
            if (table === 'gpu_sessions' && api._eq.id === session.id) {
              return Promise.resolve({ data: { ...session }, error: null });
            }
            if (table === 'subscriptions') {
              return Promise.resolve({
                data: { id: 'sub-1', server_status: 'online' },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
          single() {
            return api.maybeSingle();
          },
          update(payload) {
            return {
              eq(col, val) {
                if (table === 'gpu_sessions' && val === session.id) {
                  Object.assign(session, payload);
                }
                if (table === 'machines' && val === machine.id) {
                  Object.assign(machine, payload);
                }
                if (table === 'subscriptions') {
                  return Promise.resolve({ error: null });
                }
                return Promise.resolve({ error: null });
              },
            };
          },
          insert() {
            return Promise.resolve({ error: null });
          },
        };
        return api;
      },
    },
  };
}

function destroyedVerify() {
  return {
    state: PROVIDER_VERIFY_STATE.OK,
    outcome: PROVIDER_VERIFY_OUTCOME.VERIFIED_DESTROYED,
    snapshot: { normalizedState: 'destroyed', checkedAt: '2026-01-01T11:00:05.000Z' },
    verifiedAt: '2026-01-01T11:00:05.000Z',
  };
}

function stillRunningVerify() {
  return {
    state: PROVIDER_VERIFY_STATE.FAILED,
    outcome: PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED,
    snapshot: { normalizedState: 'running' },
    code: 'STILL_RUNNING',
    message: 'still running',
  };
}

describe('runDestroyPipeline', () => {
  it('T1 — happy path: verify → close → settle → destroyed', async () => {
    const mock = createMockSupabase(runningSession());
    const steps = [];
    let destroyCalls = 0;
    let settleCalls = 0;

    let verifyCalls = 0;
    const verifyDestroyed = async () => {
      verifyCalls += 1;
      if (verifyCalls === 1) return stillRunningVerify();
      return destroyedVerify();
    };
    const settle = async () => {
      settleCalls += 1;
      mock.session.status = 'closed';
      mock.session.ended_at = '2026-01-01T11:00:05.000Z';
      mock.session.settlement_status = 'settled';
      return {
        state: 'OK',
        sessionId: SESSION_ID,
        settlementStatus: 'settled',
        breakdown: {},
        billableSeconds: 3600,
        chargedSeconds: 3600,
        walletCharge: 0,
      };
    };

    const result = await runDestroyPipeline(
      mock.client,
      {
        gpuService: {
          destroyInstance: async () => {
            destroyCalls += 1;
          },
        },
        verifyDestroyed,
        settle,
        skipSettlement: async () => ({ state: 'SKIPPED' }),
        onStep: (s) => steps.push(s),
      },
      { userId: USER_ID, machine: mock.machine, reason: 'user_stop', skipBackup: true },
    );

    assert.equal(result.destroyed, true);
    assert.equal(result.outcome, DESTROY_PIPELINE_OUTCOME.DESTROYED);
    assert.equal(mock.session.status, 'closed');
    assert.equal(mock.session.settlement_status, 'settled');
    assert.equal(destroyCalls, 1);
    assert.equal(settleCalls, 1);
    assert.equal(mock.machine.status, 'destroyed');
    assert.equal(assertSettlementAfterVerify(steps), true);
    assert.ok(steps.indexOf(DESTROY_PIPELINE_STEP.SETTLEMENT) > steps.indexOf(DESTROY_PIPELINE_STEP.VERIFY_DESTROYED));
  });

  it('T3 — verify still running: no settlement, rollback', async () => {
    const mock = createMockSupabase(runningSession());
    let settleCalls = 0;

    const result = await runDestroyPipeline(
      mock.client,
      {
        gpuService: { destroyInstance: async () => {} },
        verifyDestroyed: async () => stillRunningVerify(),
        settle: async () => {
          settleCalls += 1;
          return { state: 'OK' };
        },
        skipSettlement: async () => ({ state: 'SKIPPED' }),
      },
      { userId: USER_ID, machine: mock.machine, reason: 'user_stop', skipBackup: true },
    );

    assert.equal(result.destroyed, false);
    assert.equal(result.outcome, DESTROY_PIPELINE_OUTCOME.ROLLED_BACK);
    assert.equal(mock.session.status, 'running');
    assert.equal(settleCalls, 0);
  });

  it('T4 — idempotent when provider already destroyed', async () => {
    const mock = createMockSupabase(runningSession());
    let destroyCalls = 0;
    const verifyDestroyed = async () => destroyedVerify();

    const result = await runDestroyPipeline(
      mock.client,
      {
        gpuService: {
          destroyInstance: async () => {
            destroyCalls += 1;
          },
        },
        verifyDestroyed,
        settle: async () => ({
          state: 'OK',
          sessionId: SESSION_ID,
          settlementStatus: 'settled',
          breakdown: {},
          billableSeconds: 3600,
          chargedSeconds: 3600,
          walletCharge: 0,
        }),
        skipSettlement: async () => ({ state: 'SKIPPED' }),
      },
      { userId: USER_ID, machine: mock.machine, reason: 'user_stop', skipBackup: true },
    );

    assert.equal(result.destroyed, true);
    assert.equal(destroyCalls, 0);
  });

  it('T5 — skipBilling skips settlement charge', async () => {
    const mock = createMockSupabase(runningSession());
    let skipCalls = 0;

    const result = await runDestroyPipeline(
      mock.client,
      {
        gpuService: { destroyInstance: async () => {} },
        verifyDestroyed: async () => destroyedVerify(),
        settle: async () => {
          throw new Error('settle should not be called');
        },
        skipSettlement: async () => {
          skipCalls += 1;
          mock.session.settlement_status = 'skipped';
          return { state: 'SKIPPED', sessionId: SESSION_ID, settlementStatus: 'skipped' };
        },
      },
      {
        userId: USER_ID,
        machine: mock.machine,
        reason: 'user_stop',
        skipBackup: true,
        skipBilling: true,
      },
    );

    assert.equal(result.destroyed, true);
    assert.equal(skipCalls, 1);
    assert.equal(mock.session.settlement_status, 'skipped');
  });

  it('T2 — provider destroy fail keeps session running, no settlement', async () => {
    const mock = createMockSupabase(runningSession());
    let settleCalls = 0;

    const result = await runDestroyPipeline(
      mock.client,
      {
        gpuService: {
          destroyInstance: async () => {
            throw new Error('destroy failed');
          },
        },
        verifyDestroyed: async () => stillRunningVerify(),
        settle: async () => {
          settleCalls += 1;
          return { state: 'OK' };
        },
        skipSettlement: async () => ({ state: 'SKIPPED' }),
      },
      { userId: USER_ID, machine: mock.machine, reason: 'user_stop', skipBackup: true },
    );

    assert.equal(result.destroyed, false);
    assert.equal(result.outcome, DESTROY_PIPELINE_OUTCOME.PROVIDER_DESTROY_FAILED);
    assert.equal(mock.session.status, 'running');
    assert.equal(settleCalls, 0);
  });

  it('T2b — destroy error but verify destroyed continues to settle', async () => {
    const mock = createMockSupabase(runningSession());
    let settleCalls = 0;
    let verifyCalls = 0;

    const result = await runDestroyPipeline(
      mock.client,
      {
        gpuService: {
          destroyInstance: async () => {
            throw new Error('Clore.ai 429: rate limit');
          },
        },
        verifyDestroyed: async () => {
          verifyCalls += 1;
          // pre-verify still running; post-fail verify + final verify destroyed
          return verifyCalls === 1 ? stillRunningVerify() : destroyedVerify();
        },
        settle: async () => {
          settleCalls += 1;
          return { state: 'OK' };
        },
        skipSettlement: async () => ({ state: 'SKIPPED' }),
      },
      { userId: USER_ID, machine: mock.machine, reason: 'user_stop', skipBackup: true },
    );

    assert.equal(result.destroyed, true);
    assert.equal(result.outcome, DESTROY_PIPELINE_OUTCOME.DESTROYED);
    assert.equal(settleCalls, 1);
    assert.ok(verifyCalls >= 2);
  });

  it('returns NO_MACHINE when nothing to destroy', async () => {
    const result = await runDestroyPipeline(
      {
        from: () => ({
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
      },
      { gpuService: { destroyInstance: async () => {} } },
      { userId: USER_ID },
    );
    assert.equal(result.outcome, DESTROY_PIPELINE_OUTCOME.NO_MACHINE);
  });

  it('T6 — missing billing_started_at still closes and settles proven running session', async () => {
    const machine = runningMachine({ billing_started_at: null });
    const mock = createMockSupabase(runningSession(), machine);

    let settleCalls = 0;
    const steps = [];

    const result = await runDestroyPipeline(
      mock.client,
      {
        gpuService: { destroyInstance: async () => {} },
        verifyDestroyed: async () => destroyedVerify(),
        settle: async () => {
          settleCalls += 1;
          mock.session.status = 'closed';
          mock.session.ended_at = '2026-01-01T11:00:05.000Z';
          mock.session.settlement_status = 'settled';
          return {
            state: 'OK',
            sessionId: SESSION_ID,
            settlementStatus: 'settled',
            breakdown: {},
            billableSeconds: 3600,
            chargedSeconds: 3600,
            walletCharge: 0,
          };
        },
        skipSettlement: async () => ({ state: 'SKIPPED' }),
        onStep: (s) => steps.push(s),
      },
      { userId: USER_ID, machine, reason: 'user_stop', skipBackup: true },
    );

    assert.equal(result.destroyed, true);
    assert.equal(result.outcome, DESTROY_PIPELINE_OUTCOME.DESTROYED);
    assert.equal(settleCalls, 1);
    assert.equal(mock.session.status, 'closed');
    assert.equal(mock.session.settlement_status, 'settled');
    assert.equal(mock.machine.status, 'destroyed');
    assert.ok(steps.includes(DESTROY_PIPELINE_STEP.SESSION_CLOSED));
    assert.ok(steps.includes(DESTROY_PIPELINE_STEP.SETTLEMENT));
    assert.equal(assertSettlementAfterVerify(steps), true);
  });

  it('T6b — missing billing_started_at with unproven session skips settlement', async () => {
    const machine = runningMachine({ billing_started_at: null });
    const mock = createMockSupabase(
      {
        ...runningSession(),
        machine_id: 'wrong-machine',
        started_at: '2025-01-01T00:00:00.000Z',
      },
      machine,
    );

    let settleCalls = 0;

    const result = await runDestroyPipeline(
      mock.client,
      {
        gpuService: { destroyInstance: async () => {} },
        verifyDestroyed: async () => destroyedVerify(),
        settle: async () => {
          settleCalls += 1;
          return { state: 'OK' };
        },
        skipSettlement: async () => ({ state: 'SKIPPED' }),
      },
      { userId: USER_ID, machine, reason: 'user_stop', skipBackup: true },
    );

    assert.equal(result.destroyed, true);
    assert.equal(settleCalls, 0);
    assert.equal(mock.session.status, 'running');
  });
});
