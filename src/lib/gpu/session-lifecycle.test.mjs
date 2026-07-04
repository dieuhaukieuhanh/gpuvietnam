import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INTERRUPT_REASON,
  SESSION_COMMAND,
  SESSION_DOMAIN_EVENT,
  SESSION_ERROR_CODE,
  SESSION_STATUS,
  SETTLEMENT_STATUS,
  SessionInvariantViolationError,
  activateRunningSession,
  assertAtMostOneRunningSession,
  assertSessionIntegrity,
  cancelSession,
  closeSession,
  completeSettlement,
  createPendingSession,
  executeCommand,
  failSettlement,
  findTransitions,
  getTransitionMap,
  handleRunningVerifyFailed,
  interruptSession,
  requestDestroy,
  retryDestroyVerification,
  retrySettlement,
  rollbackClosingToRunning,
  skipSettlement,
  startSettlement,
} from './session-lifecycle.js';

const NOW = '2026-07-03T10:00:00.000Z';

/** @param {Record<string, unknown>} [overrides] */
function ctx(overrides = {}) {
  return {
    subscriptionActive: true,
    machineExists: true,
    providerRunningVerified: true,
    providerDestroyedVerified: true,
    otherRunningSessionCount: 0,
    runningVerifyRetriesRemaining: 3,
    now: NOW,
    ...overrides,
  };
}

/** @param {Record<string, unknown>} [overrides] */
function pendingSession(overrides = {}) {
  const result = createPendingSession(
    { id: 'sess-1', userId: 'user-1', machineId: 'machine-1', ...overrides },
    ctx(),
  );
  assert.equal(result.state, 'OK');
  return result.session;
}

describe('transition map', () => {
  it('covers all design transitions', () => {
    const map = getTransitionMap();
    assert.ok(map.length >= 17);

    const keys = map.map((d) => `${d.from ?? 'null'}:${d.command}:${d.to}`);
    assert.ok(keys.includes(`null:${SESSION_COMMAND.CREATE_PENDING}:${SESSION_STATUS.PENDING}`));
    assert.ok(
      keys.includes(`${SESSION_STATUS.PENDING}:${SESSION_COMMAND.ACTIVATE_RUNNING}:${SESSION_STATUS.RUNNING}`),
    );
    assert.ok(
      keys.includes(`${SESSION_STATUS.RUNNING}:${SESSION_COMMAND.REQUEST_DESTROY}:${SESSION_STATUS.CLOSING}`),
    );
    assert.ok(keys.includes(`${SESSION_STATUS.CLOSING}:${SESSION_COMMAND.CLOSE}:${SESSION_STATUS.CLOSED}`));
  });

  it('findTransitions returns matching rows', () => {
    const rows = findTransitions(SESSION_STATUS.PENDING, SESSION_COMMAND.INTERRUPT);
    assert.equal(rows.length, 2);
  });
});

describe('createPendingSession', () => {
  it('creates pending session (happy path)', () => {
    const result = createPendingSession(
      { id: 's1', userId: 'u1', machineId: 'm1' },
      ctx(),
    );
    assert.equal(result.state, 'OK');
    assert.equal(result.session.status, SESSION_STATUS.PENDING);
    assert.equal(result.event, SESSION_DOMAIN_EVENT.SESSION_CREATED);
    assert.equal(result.session.settlement_status, SETTLEMENT_STATUS.NOT_APPLICABLE);
    assert.equal(result.session.started_at, null);
  });

  it('rejects when subscription inactive', () => {
    const result = createPendingSession(
      { id: 's1', userId: 'u1', machineId: 'm1' },
      ctx({ subscriptionActive: false }),
    );
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.SUBSCRIPTION_NOT_ACTIVE);
  });

  it('rejects when user already has running session', () => {
    const result = createPendingSession(
      { id: 's1', userId: 'u1', machineId: 'm1' },
      ctx({ otherRunningSessionCount: 1 }),
    );
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.MULTIPLE_RUNNING_SESSIONS);
  });

  it('throws invariant violation when multiple running detected', () => {
    assert.throws(
      () =>
        createPendingSession(
          { id: 's1', userId: 'u1', machineId: 'm1' },
          ctx({ otherRunningSessionCount: 2 }),
        ),
      SessionInvariantViolationError,
    );
  });

  it('forbids completed status on create', () => {
    const result = createPendingSession(
      { id: 's1', userId: 'u1', status: SESSION_STATUS.COMPLETED },
      ctx(),
    );
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.LEGACY_STATUS_FORBIDDEN);
  });
});

describe('activateRunningSession', () => {
  it('activates pending to running', () => {
    const session = pendingSession();
    const result = activateRunningSession(session, ctx());
    assert.equal(result.state, 'OK');
    assert.equal(result.session.status, SESSION_STATUS.RUNNING);
    assert.equal(result.session.started_at, NOW);
    assert.equal(result.event, SESSION_DOMAIN_EVENT.SESSION_ACTIVATED);
  });

  it('rejects without provider verify', () => {
    const session = pendingSession();
    const result = activateRunningSession(session, ctx({ providerRunningVerified: false }));
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.PROVIDER_NOT_VERIFIED);
  });

  it('rejects from running state', () => {
    const session = pendingSession();
    const running = activateRunningSession(session, ctx()).session;
    const result = activateRunningSession(running, ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.SESSION_NOT_PENDING);
  });
});

describe('handleRunningVerifyFailed', () => {
  it('stays pending when retries remain', () => {
    const session = pendingSession();
    const result = handleRunningVerifyFailed(session, ctx({ runningVerifyRetriesRemaining: 2 }));
    assert.equal(result.state, 'IGNORED');
    assert.equal(result.session.status, SESSION_STATUS.PENDING);
  });

  it('interrupts when retries exhausted', () => {
    const session = pendingSession();
    const result = handleRunningVerifyFailed(session, ctx({ runningVerifyRetriesRemaining: 0 }));
    assert.equal(result.state, 'OK');
    assert.equal(result.session.status, SESSION_STATUS.INTERRUPTED);
  });
});

describe('interruptSession', () => {
  it('provision failed from pending', () => {
    const session = pendingSession();
    const result = interruptSession(session, ctx(), {
      reason: INTERRUPT_REASON.PROVISION_FAILED,
    });
    assert.equal(result.state, 'OK');
    assert.equal(result.session.settlement_status, SETTLEMENT_STATUS.NOT_APPLICABLE);
  });

  it('cancel from pending via cancelSession', () => {
    const session = pendingSession();
    const result = cancelSession(session, ctx());
    assert.equal(result.state, 'OK');
    assert.equal(result.event, SESSION_DOMAIN_EVENT.SESSION_CANCELLED);
  });

  it('orphan from running sets ended_at', () => {
    let session = pendingSession();
    session = activateRunningSession(session, ctx()).session;
    const result = interruptSession(session, ctx(), { reason: INTERRUPT_REASON.ORPHAN });
    assert.equal(result.state, 'OK');
    assert.equal(result.session.ended_at, NOW);
  });

  it('ignores duplicate interrupt on terminal interrupted', () => {
    const session = pendingSession();
    const interrupted = interruptSession(session, ctx(), {
      reason: INTERRUPT_REASON.PROVISION_FAILED,
    }).session;
    const result = interruptSession(interrupted, ctx(), {
      reason: INTERRUPT_REASON.PROVISION_FAILED,
    });
    assert.equal(result.state, 'IGNORED');
  });

  it('rejects invalid reason', () => {
    const session = pendingSession();
    const result = interruptSession(session, ctx(), { reason: 'unknown' });
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.INVALID_INTERRUPT_REASON);
  });
});

describe('requestDestroy and closing lifecycle', () => {
  /** @returns {import('./session-lifecycle.js').SessionRecord} */
  function runningSession() {
    const session = pendingSession();
    return activateRunningSession(session, ctx()).session;
  }

  it('enters closing from running', () => {
    const session = runningSession();
    const result = requestDestroy(session, ctx(), { destroyReason: 'user' });
    assert.equal(result.state, 'OK');
    assert.equal(result.session.status, SESSION_STATUS.CLOSING);
    assert.equal(result.session.destroy_reason, 'user');
    assert.equal(result.session.settlement_status, SETTLEMENT_STATUS.AWAITING_VERIFY);
  });

  it('requires destroy reason', () => {
    const session = runningSession();
    const result = requestDestroy(session, ctx(), {});
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.DESTROY_REASON_REQUIRED);
  });

  it('ignores duplicate destroy while closing', () => {
    let session = runningSession();
    session = requestDestroy(session, ctx(), { destroyReason: 'user' }).session;
    const result = requestDestroy(session, ctx(), { destroyReason: 'user' });
    assert.equal(result.state, 'IGNORED');
  });

  it('rejects destroy from pending', () => {
    const session = pendingSession();
    const result = requestDestroy(session, ctx(), { destroyReason: 'user' });
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.SESSION_NOT_RUNNING);
  });

  it('closes after provider destroyed verified', () => {
    let session = runningSession();
    session = requestDestroy(session, ctx(), { destroyReason: 'user' }).session;
    const result = closeSession(session, ctx({ providerDestroyedVerified: true }));
    assert.equal(result.state, 'OK');
    assert.equal(result.session.status, SESSION_STATUS.CLOSED);
    assert.equal(result.session.ended_at, NOW);
    assert.equal(result.session.settlement_status, SETTLEMENT_STATUS.PENDING);
  });

  it('rejects close without provider verify (SD-7 / OP-1)', () => {
    let session = runningSession();
    session = requestDestroy(session, ctx(), { destroyReason: 'user' }).session;
    const result = closeSession(session, ctx({ providerDestroyedVerified: false }));
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.PROVIDER_NOT_VERIFIED);
  });

  it('rejects close directly from running', () => {
    const session = runningSession();
    const result = closeSession(session, ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.SESSION_NOT_CLOSING);
  });

  it('rolls back closing to running on verify fail', () => {
    let session = runningSession();
    session = requestDestroy(session, ctx(), { destroyReason: 'user' }).session;
    const result = rollbackClosingToRunning(session, ctx());
    assert.equal(result.state, 'OK');
    assert.equal(result.session.status, SESSION_STATUS.RUNNING);
    assert.equal(result.session.destroy_reason, null);
  });
});

describe('retryDestroyVerification', () => {
  /** @returns {import('./session-lifecycle.js').SessionRecord} */
  function closingSession() {
    let session = pendingSession();
    session = activateRunningSession(session, ctx()).session;
    return requestDestroy(session, ctx(), { destroyReason: 'idle' }).session;
  }

  it('closes on destroyed outcome', () => {
    const session = closingSession();
    const result = retryDestroyVerification(session, ctx({ verifyOutcome: 'destroyed' }));
    assert.equal(result.state, 'OK');
    assert.equal(result.session.status, SESSION_STATUS.CLOSED);
  });

  it('rolls back on still_running outcome', () => {
    const session = closingSession();
    const result = retryDestroyVerification(session, ctx({ verifyOutcome: 'still_running' }));
    assert.equal(result.state, 'OK');
    assert.equal(result.session.status, SESSION_STATUS.RUNNING);
  });

  it('stays closing on timeout outcome', () => {
    const session = closingSession();
    const result = retryDestroyVerification(session, ctx({ verifyOutcome: 'timeout' }));
    assert.equal(result.state, 'IGNORED');
    assert.equal(result.session.status, SESSION_STATUS.CLOSING);
  });

  it('ignores when already closed', () => {
    let session = closingSession();
    session = retryDestroyVerification(session, ctx({ verifyOutcome: 'destroyed' })).session;
    const result = retryDestroyVerification(session, ctx({ verifyOutcome: 'timeout' }));
    assert.equal(result.state, 'IGNORED');
  });
});

describe('settlement sub-state', () => {
  /** @returns {import('./session-lifecycle.js').SessionRecord} */
  function closedSession() {
    let session = pendingSession();
    session = activateRunningSession(session, ctx()).session;
    session = requestDestroy(session, ctx(), { destroyReason: 'user' }).session;
    return closeSession(session, ctx()).session;
  }

  it('happy path settlement flow', () => {
    let session = closedSession();
    assert.equal(startSettlement(session, ctx()).session.settlement_status, SETTLEMENT_STATUS.IN_PROGRESS);
    session = startSettlement(session, ctx()).session;
    assert.equal(completeSettlement(session, ctx()).session.settlement_status, SETTLEMENT_STATUS.SETTLED);
  });

  it('ignores duplicate completeSettlement when settled', () => {
    let session = closedSession();
    session = startSettlement(session, ctx()).session;
    session = completeSettlement(session, ctx()).session;
    const result = completeSettlement(session, ctx());
    assert.equal(result.state, 'IGNORED');
  });

  it('retry settlement from failed', () => {
    let session = closedSession();
    session = startSettlement(session, ctx()).session;
    session = failSettlement(session, ctx()).session;
    const result = retrySettlement(session, ctx());
    assert.equal(result.state, 'OK');
    assert.equal(result.session.settlement_status, SETTLEMENT_STATUS.IN_PROGRESS);
  });

  it('ignores retry when already settled', () => {
    let session = closedSession();
    session = startSettlement(session, ctx()).session;
    session = completeSettlement(session, ctx()).session;
    const result = retrySettlement(session, ctx());
    assert.equal(result.state, 'IGNORED');
  });

  it('skip settlement', () => {
    const session = closedSession();
    const result = skipSettlement(session, ctx());
    assert.equal(result.state, 'OK');
    assert.equal(result.session.settlement_status, SETTLEMENT_STATUS.SKIPPED);
  });
});

describe('legacy completed', () => {
  it('rejects activate on completed session', () => {
    /** @type {import('./session-lifecycle.js').SessionRecord} */
    const legacy = {
      id: 'legacy-1',
      userId: 'u1',
      status: SESSION_STATUS.COMPLETED,
      machineId: null,
      started_at: NOW,
      ended_at: NOW,
      settlement_status: SETTLEMENT_STATUS.SETTLED,
      destroy_reason: null,
      verified_running_at: null,
      verified_destroyed_at: null,
    };
    const result = activateRunningSession(legacy, ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.SESSION_LEGACY_COMPLETED);
  });

  it('assertSessionIntegrity allows legacy completed', () => {
    assert.doesNotThrow(() =>
      assertSessionIntegrity({
        id: 'legacy-1',
        userId: 'u1',
        status: SESSION_STATUS.COMPLETED,
        started_at: NOW,
        ended_at: NOW,
        settlement_status: SETTLEMENT_STATUS.SETTLED,
      }),
    );
  });
});

describe('invariants', () => {
  it('assertSessionIntegrity throws on running without started_at', () => {
    assert.throws(
      () =>
        assertSessionIntegrity({
          id: 'x',
          userId: 'u',
          status: SESSION_STATUS.RUNNING,
          started_at: null,
        }),
      SessionInvariantViolationError,
    );
  });

  it('assertSessionIntegrity throws on closed without ended_at', () => {
    assert.throws(
      () =>
        assertSessionIntegrity({
          id: 'x',
          userId: 'u',
          status: SESSION_STATUS.CLOSED,
          ended_at: null,
          settlement_status: SETTLEMENT_STATUS.PENDING,
        }),
      SessionInvariantViolationError,
    );
  });

  it('assertAtMostOneRunningSession throws when count > 1', () => {
    assert.throws(
      () => assertAtMostOneRunningSession({ otherRunningSessionCount: 2 }),
      SessionInvariantViolationError,
    );
  });

  it('started_at immutable on activate', () => {
    const session = {
      ...pendingSession(),
      started_at: '2026-01-01T00:00:00.000Z',
    };
    assert.throws(
      () => activateRunningSession(session, ctx(), { started_at: NOW }),
      SessionInvariantViolationError,
    );
  });

  it('ended_at immutable on close', () => {
    let session = pendingSession();
    session = activateRunningSession(session, ctx()).session;
    session = requestDestroy(session, ctx(), { destroyReason: 'user' }).session;
    session = {
      ...session,
      ended_at: '2026-01-01T00:00:00.000Z',
    };
    assert.throws(
      () => closeSession(session, ctx(), { ended_at: NOW }),
      SessionInvariantViolationError,
    );
  });
});

describe('full happy path lifecycle', () => {
  it('pending → running → closing → closed → settled', () => {
    let session = pendingSession();
    session = activateRunningSession(session, ctx()).session;
    session = requestDestroy(session, ctx(), { destroyReason: 'user' }).session;
    session = closeSession(session, ctx()).session;
    session = startSettlement(session, ctx()).session;
    session = completeSettlement(session, ctx()).session;

    assert.equal(session.status, SESSION_STATUS.CLOSED);
    assert.equal(session.settlement_status, SETTLEMENT_STATUS.SETTLED);
    assert.ok(session.started_at);
    assert.ok(session.ended_at);
  });
});

describe('illegal transitions', () => {
  it('returns INVALID_TRANSITION for unknown command', () => {
    const session = pendingSession();
    const result = executeCommand(session, 'UNKNOWN', ctx(), {});
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.INVALID_TRANSITION);
  });

  it('rejects interrupted → running (SD-17)', () => {
    const session = interruptSession(pendingSession(), ctx(), {
      reason: INTERRUPT_REASON.CANCELLED,
    }).session;
    const result = activateRunningSession(session, ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.SESSION_NOT_PENDING);
  });
});
