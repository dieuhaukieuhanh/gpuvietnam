/**
 * P0-B Billing MVP — acceptance cases (pure + lifecycle).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RUNTIME_READY_FOR_BILLING,
  isRuntimeReadyForBilling,
  calculateBillableSecondsFromClose,
  shouldKeepBillingSessionOpenOnRuntimeDead,
  isBillingCloseSettlementAllowed,
} from './billing-session-p0b.js';
import {
  createPendingSession,
  activateRunningSession,
  closeSession,
  SESSION_STATUS,
  SETTLEMENT_STATUS,
} from './session-lifecycle.js';
import { evaluateSettlementEligibility } from './settlement-core.js';

const NOW = '2026-07-24T10:00:00.000Z';
const CLOSE = '2026-07-24T12:00:00.000Z';

function readyMachine() {
  return {
    status: 'running',
    ip_address: '1.2.3.4',
    port: 8188,
    projection_verified_at: NOW,
    projection_message: 'ComfyUI sẵn sàng',
  };
}

describe('P0-B Billing MVP', () => {
  it('exports RUNTIME_READY_FOR_BILLING event name', () => {
    assert.equal(RUNTIME_READY_FOR_BILLING, 'RUNTIME_READY_FOR_BILLING');
  });

  it('1) Ready → wait → Close → billable = close − started', () => {
    assert.equal(
      isRuntimeReadyForBilling(readyMachine(), { providerRunningVerified: true }),
      true,
    );

    const pending = createPendingSession(
      { id: 's1', userId: 'u1', machineId: 'm1', created_at: NOW },
      { subscriptionActive: true, otherRunningSessionCount: 0, now: NOW },
    );
    assert.equal(pending.state, 'OK');
    assert.equal(pending.session.started_at, null);

    const running = activateRunningSession(
      pending.session,
      {
        subscriptionActive: true,
        machineExists: true,
        providerRunningVerified: true,
        otherRunningSessionCount: 0,
        now: NOW,
      },
      { started_at: NOW, verified_running_at: NOW },
    );
    assert.equal(running.state, 'OK');
    assert.equal(running.session.started_at, NOW);

    const closed = closeSession(
      running.session,
      { billingCloseRequested: true, now: CLOSE },
      { ended_at: CLOSE, close_requested_at: CLOSE, destroyReason: 'user_stop' },
    );
    assert.equal(closed.state, 'OK');
    assert.equal(closed.session.status, SESSION_STATUS.CLOSED);
    assert.equal(closed.session.close_requested_at, CLOSE);
    assert.equal(closed.session.ended_at, CLOSE);
    assert.equal(closed.session.verified_destroyed_at, null);
    assert.equal(closed.session.settlement_status, SETTLEMENT_STATUS.PENDING);

    const seconds = calculateBillableSecondsFromClose(
      closed.session.started_at,
      closed.session.close_requested_at,
    );
    assert.equal(seconds, 2 * 3600);

    const elig = evaluateSettlementEligibility(closed.session, {
      billingCloseVerified: true,
    });
    assert.equal(elig.ok, true);
  });

  it('2) Close before Ready → bill 0 (started_at null)', () => {
    assert.equal(calculateBillableSecondsFromClose(null, CLOSE), 0);
    assert.equal(calculateBillableSecondsFromClose('', CLOSE), 0);
  });

  it('3) Runtime DEAD when Session OPEN → keep open (no settle signal)', () => {
    assert.equal(
      shouldKeepBillingSessionOpenOnRuntimeDead({
        status: 'running',
        started_at: NOW,
      }),
      true,
    );
    assert.equal(
      shouldKeepBillingSessionOpenOnRuntimeDead({
        status: 'pending',
        started_at: null,
      }),
      false,
    );
    assert.equal(
      shouldKeepBillingSessionOpenOnRuntimeDead({
        status: 'closed',
        started_at: NOW,
      }),
      false,
    );
  });

  it('4) Close when Runtime DEAD → settle at close_requested_at', () => {
    const session = {
      id: 's2',
      userId: 'u1',
      status: 'running',
      machineId: 'm1',
      started_at: NOW,
      ended_at: null,
      settlement_status: null,
      verified_running_at: NOW,
      verified_destroyed_at: null,
      close_requested_at: null,
    };
    // Runtime dead — session still open
    assert.equal(shouldKeepBillingSessionOpenOnRuntimeDead(session), true);

    const closed = closeSession(
      session,
      { billingCloseRequested: true, now: CLOSE },
      { ended_at: CLOSE, close_requested_at: CLOSE, destroyReason: 'user_stop' },
    );
    assert.equal(closed.state, 'OK');
    assert.equal(closed.session.close_requested_at, CLOSE);
    assert.equal(
      calculateBillableSecondsFromClose(closed.session.started_at, closed.session.close_requested_at),
      2 * 3600,
    );
    assert.equal(
      evaluateSettlementEligibility(closed.session, { billingCloseVerified: true }).ok,
      true,
    );
  });

  it('5) Close lặp → idempotent (second close ignored)', () => {
    const session = {
      id: 's3',
      userId: 'u1',
      status: 'running',
      machineId: 'm1',
      started_at: NOW,
      ended_at: null,
      settlement_status: null,
      verified_running_at: NOW,
      verified_destroyed_at: null,
      close_requested_at: null,
    };
    const first = closeSession(
      session,
      { billingCloseRequested: true, now: CLOSE },
      { ended_at: CLOSE, close_requested_at: CLOSE },
    );
    assert.equal(first.state, 'OK');

    const second = closeSession(
      first.session,
      { billingCloseRequested: true, now: '2026-07-24T13:00:00.000Z' },
      { ended_at: '2026-07-24T13:00:00.000Z', close_requested_at: '2026-07-24T13:00:00.000Z' },
    );
    assert.equal(second.state, 'IGNORED');
    assert.equal(second.session.ended_at, CLOSE);
    assert.equal(second.session.close_requested_at, CLOSE);
  });

  it('settlement eligibility: close_requested_at unlocks without destroy verify', () => {
    assert.equal(
      isBillingCloseSettlementAllowed(
        { close_requested_at: CLOSE, verified_destroyed_at: null },
        {},
      ),
      true,
    );
    assert.equal(
      isBillingCloseSettlementAllowed(
        { close_requested_at: null, verified_destroyed_at: null },
        {},
      ),
      false,
    );
    assert.equal(
      evaluateSettlementEligibility(
        {
          status: 'closed',
          ended_at: CLOSE,
          close_requested_at: CLOSE,
          settlement_status: 'pending',
        },
        {},
      ).ok,
      true,
    );
  });

  it('Ready gate rejects machine without Workspace attach signal', () => {
    assert.equal(
      isRuntimeReadyForBilling(
        { status: 'running' },
        { providerRunningVerified: true },
      ),
      false,
    );
    assert.equal(
      isRuntimeReadyForBilling(readyMachine(), { providerRunningVerified: false }),
      false,
    );
  });
});
