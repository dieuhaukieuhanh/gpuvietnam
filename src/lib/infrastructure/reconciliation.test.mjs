import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_STALE_CLOSING_MS,
  DRIFT_TYPE,
  REPAIR_OUTCOME,
  detectDestroyedMismatch,
  detectOrphanSession,
  detectSettlementDrift,
  detectStaleClosing,
  detectZombieLocal,
  dedupeDrifts,
} from './reconciliation-core.js';
import {
  repairDriftItem,
  runInfrastructureReconciliation,
} from './reconciliation.js';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '22222222-2222-2222-2222-222222222222';
const MACHINE_ID = '33333333-3333-3333-3333-333333333333';
const NOW = '2026-07-03T12:00:00.000Z';

describe('reconciliation-core detection (M13)', () => {
  it('T1 — zombie local when DB running (no started_at) and provider destroyed', () => {
    const drift = detectZombieLocal(
      { id: SESSION_ID, status: 'running', user_id: USER_ID },
      { id: MACHINE_ID, status: 'running', instance_id: 'inst-1', user_id: USER_ID },
      { normalizedState: 'destroyed', instanceId: 'inst-1' },
      { outcome: 'verified_destroyed' },
    );
    assert.equal(drift?.driftType, DRIFT_TYPE.ZOMBIE_LOCAL);
  });

  it('P0-B — open billable session is not zombie_local when provider destroyed', () => {
    const drift = detectZombieLocal(
      {
        id: SESSION_ID,
        status: 'running',
        started_at: NOW,
        user_id: USER_ID,
      },
      { id: MACHINE_ID, status: 'error', instance_id: 'inst-1', user_id: USER_ID },
      { normalizedState: 'destroyed', instanceId: 'inst-1' },
      { outcome: 'verified_destroyed' },
    );
    assert.equal(drift, null);
  });

  it('T2 — destroyed mismatch when DB destroyed but provider running', () => {
    const drift = detectDestroyedMismatch(
      { id: MACHINE_ID, status: 'destroyed', instance_id: 'inst-1', user_id: USER_ID },
      { normalizedState: 'running', instanceId: 'inst-1' },
    );
    assert.equal(drift?.driftType, DRIFT_TYPE.DESTROYED_MISMATCH);
  });

  it('T4 — stale closing when closing exceeds timeout', () => {
    const closingSince = new Date(
      new Date(NOW).getTime() - DEFAULT_STALE_CLOSING_MS - 60_000,
    ).toISOString();
    const drift = detectStaleClosing(
      { id: SESSION_ID, status: 'closing', user_id: USER_ID },
      { id: MACHINE_ID, closing_started_at: closingSince, user_id: USER_ID },
      NOW,
    );
    assert.equal(drift?.driftType, DRIFT_TYPE.STALE_CLOSING);
  });

  it('detects orphan running session without active machine (non-billable)', () => {
    const drift = detectOrphanSession(
      { id: SESSION_ID, status: 'running', user_id: USER_ID },
      { id: MACHINE_ID, status: 'destroyed' },
    );
    assert.equal(drift?.driftType, DRIFT_TYPE.ORPHAN_SESSION);
  });

  it('P0-B — billable OPEN session is never orphan_session', () => {
    const drift = detectOrphanSession(
      { id: SESSION_ID, status: 'running', started_at: NOW, user_id: USER_ID },
      { id: MACHINE_ID, status: 'error' },
    );
    assert.equal(drift, null);
  });

  it('detects settlement failed on closed session', () => {
    const drift = detectSettlementDrift({
      id: SESSION_ID,
      status: 'closed',
      settlement_status: 'failed',
      verified_destroyed_at: NOW,
    });
    assert.equal(drift?.driftType, DRIFT_TYPE.SETTLEMENT_FAILED);
  });

  it('already healthy session has no settlement drift', () => {
    const drift = detectSettlementDrift({
      id: SESSION_ID,
      status: 'closed',
      settlement_status: 'settled',
    });
    assert.equal(drift, null);
  });

  it('dedupeDrifts removes duplicates', () => {
    const drifts = dedupeDrifts([
      { driftType: 'orphan_session', entityType: 'session', entityId: 's1', message: 'a' },
      { driftType: 'orphan_session', entityType: 'session', entityId: 's1', message: 'b' },
    ]);
    assert.equal(drifts.length, 1);
  });
});

describe('repairDriftItem (M13)', () => {
  it('T5 — P0-B repair orphan skips billable OPEN session (no close / no settle)', async () => {
    /** @type {Record<string, unknown>} */
    const session = {
      id: SESSION_ID,
      user_id: USER_ID,
      machine_id: MACHINE_ID,
      status: 'running',
      started_at: '2026-07-03T10:00:00.000Z',
      ended_at: null,
      settlement_status: null,
    };

    const supabase = {
      from(table) {
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          maybeSingle() {
            if (table === 'gpu_sessions') {
              return Promise.resolve({ data: { ...session }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          update(payload) {
            return {
              eq(_col, val) {
                if (val === SESSION_ID) Object.assign(session, payload);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
        return api;
      },
    };

    let settleCalled = false;
    const result = await repairDriftItem(
      supabase,
      {
        driftType: DRIFT_TYPE.ORPHAN_SESSION,
        entityType: 'session',
        entityId: SESSION_ID,
        message: 'orphan',
        details: { userId: USER_ID },
      },
      {
        now: NOW,
        settle: async () => {
          settleCalled = true;
          return { state: 'OK' };
        },
      },
    );

    assert.equal(result.outcome, REPAIR_OUTCOME.SKIPPED);
    assert.equal(result.reason, 'open_billable_session_kept_open');
    assert.equal(session.status, 'running');
    assert.equal(settleCalled, false);
  });

  it('destroyed mismatch repair is operator-only skip', async () => {
    const result = await repairDriftItem(
      {},
      {
        driftType: DRIFT_TYPE.DESTROYED_MISMATCH,
        entityType: 'machine',
        entityId: MACHINE_ID,
        message: 'mismatch',
      },
      {},
    );
    assert.equal(result.outcome, REPAIR_OUTCOME.SKIPPED);
    assert.equal(result.reason, 'operator_required');
  });

  it('settlement retry delegates to M6 settleSession', async () => {
    /** @type {Record<string, unknown>} */
    const row = {
      id: SESSION_ID,
      user_id: USER_ID,
      status: 'closed',
      settlement_status: 'failed',
      verified_destroyed_at: NOW,
      started_at: '2026-07-03T10:00:00.000Z',
      ended_at: '2026-07-03T11:00:00.000Z',
    };

    const supabase = {
      from() {
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          maybeSingle() {
            return Promise.resolve({ data: { ...row }, error: null });
          },
        };
        return api;
      },
    };

    let settleCalls = 0;
    const result = await repairDriftItem(
      supabase,
      {
        driftType: DRIFT_TYPE.SETTLEMENT_FAILED,
        entityType: 'session',
        entityId: SESSION_ID,
        message: 'failed',
      },
      {
        settle: async () => {
          settleCalls += 1;
          return { state: 'OK', settlementStatus: 'settled' };
        },
      },
    );

    assert.equal(result.outcome, REPAIR_OUTCOME.REPAIRED);
    assert.equal(settleCalls, 1);
  });

  it('duplicate reconciliation on orphan is idempotent', async () => {
    /** @type {Record<string, unknown>} */
    const session = {
      id: SESSION_ID,
      user_id: USER_ID,
      status: 'closed',
      settlement_status: 'settled',
      started_at: NOW,
      ended_at: NOW,
    };

    const supabase = {
      from() {
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          maybeSingle() {
            return Promise.resolve({ data: { ...session }, error: null });
          },
          update() {
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
        return api;
      },
    };

    const result = await repairDriftItem(
      supabase,
      {
        driftType: DRIFT_TYPE.ORPHAN_SESSION,
        entityType: 'session',
        entityId: SESSION_ID,
        message: 'orphan',
      },
      { now: NOW },
    );

    assert.equal(result.outcome, REPAIR_OUTCOME.ALREADY_CONSISTENT);
  });

  it('settlement retry without verify is skipped', async () => {
    const supabase = {
      from() {
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          maybeSingle() {
            return Promise.resolve({
              data: {
                id: SESSION_ID,
                user_id: USER_ID,
                status: 'closed',
                settlement_status: 'failed',
                verified_destroyed_at: null,
              },
              error: null,
            });
          },
        };
        return api;
      },
    };

    const result = await repairDriftItem(
      supabase,
      {
        driftType: DRIFT_TYPE.SETTLEMENT_FAILED,
        entityType: 'session',
        entityId: SESSION_ID,
        message: 'failed',
      },
      { settle: async () => ({ state: 'OK' }) },
    );

    assert.equal(result.outcome, REPAIR_OUTCOME.SKIPPED);
    assert.equal(result.reason, 'awaiting_provider_verify');
  });
});

describe('runInfrastructureReconciliation (M13)', () => {
  it('T3 — scan-only run does not call settlement', async () => {
    let settleCalled = false;
    const supabase = {
      from(table) {
        const api = {
          select() {
            return api;
          },
          in() {
            return api;
          },
          order() {
            return api;
          },
          limit() {
            if (table === 'gpu_sessions') {
              return Promise.resolve({
                data: [
                  {
                    id: SESSION_ID,
                    user_id: USER_ID,
                    status: 'closed',
                    settlement_status: 'failed',
                    verified_destroyed_at: NOW,
                    machine_id: MACHINE_ID,
                  },
                ],
                error: null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          },
        };
        return api;
      },
    };

    const result = await runInfrastructureReconciliation(
      supabase,
      {
        settle: async () => {
          settleCalled = true;
          return { state: 'OK' };
        },
      },
      { repair: false, now: NOW },
    );

    assert.ok(result.driftCount >= 1);
    assert.equal(settleCalled, false);
    assert.equal(result.repair, false);
  });

  it('reconciliation rerun remains safe when no drifts', async () => {
    const supabase = {
      from() {
        const api = {
          select() {
            return api;
          },
          in() {
            return api;
          },
          order() {
            return api;
          },
          limit() {
            return Promise.resolve({ data: [], error: null });
          },
        };
        return api;
      },
    };

    const first = await runInfrastructureReconciliation(supabase, {}, { repair: true, now: NOW });
    const second = await runInfrastructureReconciliation(supabase, {}, { repair: true, now: NOW });

    assert.equal(first.driftCount, 0);
    assert.equal(second.driftCount, 0);
    assert.equal(first.counts.repaired, 0);
    assert.equal(second.counts.repaired, 0);
  });
});

describe('M13 provider-verify contract wiring', () => {
  it('reconcileMachine returns drifts from core detection', async () => {
    const { reconcileMachine } = await import('../gpu/provider-verify.js');
    const result = reconcileMachine({
      machine: { id: MACHINE_ID, status: 'destroyed', instance_id: 'i1', user_id: USER_ID },
      providerSnapshot: { normalizedState: 'running', instanceId: 'i1' },
    });
    assert.equal(result.drifts.length, 1);
    assert.equal(result.drifts[0].driftType, DRIFT_TYPE.DESTROYED_MISMATCH);
  });

  it('reconcileSettlement does not settle', async () => {
    const { reconcileSettlement } = await import('../gpu/provider-verify.js');
    const result = reconcileSettlement({
      session: {
        id: SESSION_ID,
        status: 'closed',
        settlement_status: 'failed',
        verified_destroyed_at: NOW,
      },
    });
    assert.equal(result.drifts.length, 1);
    assert.equal(result.drifts[0].driftType, DRIFT_TYPE.SETTLEMENT_FAILED);
  });
});
