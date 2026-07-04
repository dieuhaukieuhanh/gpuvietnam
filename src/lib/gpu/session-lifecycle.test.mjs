import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import {
  SESSION_COMMAND,
  SESSION_DOMAIN_EVENT,
  SESSION_ERROR_CODE,
  SESSION_STATUS,
  SETTLEMENT_STATUS,
  SessionInvariantViolationError,
  activateRunningSession,
  assertAtMostOneRunningSession,
  assertSessionIntegrity,
  closeSession,
  completeSettlement,
  createPendingSession,
  executeCommand,
  failSettlement,
  findTransitions,
  getTransitionMap,
  isScbStatus,
  isTerminalStatus,
  retrySettlement,
  skipSettlement,
  startSettlement,
} from './session-lifecycle.js';

const NOW = '2026-07-03T10:00:00.000Z';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = join(__dirname, 'session-lifecycle.js');
const srcText = readFileSync(srcPath, 'utf8');

/** @param {Record<string, unknown>} [overrides] */
function ctx(overrides = {}) {
  return {
    subscriptionActive: true,
    machineExists: true,
    providerRunningVerified: true,
    providerDestroyedVerified: true,
    otherRunningSessionCount: 0,
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

/** @returns {import('./session-lifecycle.js').SessionRecord} */
function runningSession() {
  const session = pendingSession();
  return activateRunningSession(session, ctx()).session;
}

/** @returns {import('./session-lifecycle.js').SessionRecord} */
function closedSession() {
  let session = runningSession();
  return closeSession(session, ctx()).session;
}

describe('SCB 3.0 purity', () => {
  it('SESSION_STATUS only contains pending, running, closed', () => {
    assert.deepEqual(
      Object.values(SESSION_STATUS).sort(),
      ['closed', 'pending', 'running'],
    );
  });

  it('source file contains no legacy state tokens', () => {
    const legacyIdentifiers = [
      "'closing'",
      "'interrupted'",
      "'completed'",
      'INTERRUPT_REASON',
      'REQUEST_DESTROY',
      'ROLLBACK_CLOSING',
      'RETRY_DESTROY_VERIFY',
      'RUNNING_VERIFY_FAILED',
      'SESSION_LEGACY_COMPLETED',
      'LEGACY_STATUS_FORBIDDEN',
      'INVALID_INTERRUPT_REASON',
      'SESSION_NOT_CLOSING',
      'DESTROY_INITIATED',
      'SESSION_CANCELLED',
      'CLOSING_ROLLBACK',
      'DESTROY_VERIFY_TIMEOUT',
      'SESSION_INTERRUPTED',
      'cancelSession',
      'interruptSession',
      'handleRunningVerifyFailed',
      'rollbackClosingToRunning',
      'retryDestroyVerification',
      'notLegacyCompleted',
      'statusClosing',
      'destroyReasonProvided',
    ];
    for (const token of legacyIdentifiers) {
      assert.ok(
        !srcText.includes(token),
        `legacy identifier "${token}" still present in session-lifecycle.js`,
      );
    }
  });

  it('transition map only references the three SCB statuses', () => {
    const map = getTransitionMap();
    const used = new Set();
    for (const def of map) {
      if (def.from != null) used.add(def.from);
      if (def.to != null) used.add(def.to);
    }
    for (const status of used) {
      assert.ok(
        status === SESSION_STATUS.PENDING ||
          status === SESSION_STATUS.RUNNING ||
          status === SESSION_STATUS.CLOSED,
        `non-SCB status in transition map: ${status}`,
      );
    }
  });
});

describe('transition map', () => {
  it('covers all SCB 3.0 transitions', () => {
    const map = getTransitionMap();
    assert.ok(map.length >= 8);

    const keys = map.map((d) => `${d.from ?? 'null'}:${d.command}:${d.to}`);
    assert.ok(keys.includes(`null:${SESSION_COMMAND.CREATE_PENDING}:${SESSION_STATUS.PENDING}`));
    assert.ok(
      keys.includes(`${SESSION_STATUS.PENDING}:${SESSION_COMMAND.ACTIVATE_RUNNING}:${SESSION_STATUS.RUNNING}`),
    );
    assert.ok(
      keys.includes(`${SESSION_STATUS.RUNNING}:${SESSION_COMMAND.CLOSE}:${SESSION_STATUS.CLOSED}`),
    );
  });

  it('findTransitions returns matching rows', () => {
    const rows = findTransitions(SESSION_STATUS.CLOSED, SESSION_COMMAND.START_SETTLEMENT);
    assert.equal(rows.length, 1);
  });

  it('findTransitions returns empty for removed legacy commands', () => {
    assert.equal(findTransitions(SESSION_STATUS.RUNNING, 'REQUEST_DESTROY').length, 0);
    assert.equal(findTransitions(SESSION_STATUS.RUNNING, 'INTERRUPT').length, 0);
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
    assert.equal(result.session.ended_at, null);
    assert.equal(result.session.destroy_reason, null);
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
});

describe('activateRunningSession', () => {
  it('activates pending to running', () => {
    const session = pendingSession();
    const result = activateRunningSession(session, ctx());
    assert.equal(result.state, 'OK');
    assert.equal(result.session.status, SESSION_STATUS.RUNNING);
    assert.equal(result.session.started_at, NOW);
    assert.equal(result.session.verified_running_at, NOW);
    assert.equal(result.event, SESSION_DOMAIN_EVENT.SESSION_ACTIVATED);
  });

  it('rejects without provider verify', () => {
    const session = pendingSession();
    const result = activateRunningSession(session, ctx({ providerRunningVerified: false }));
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.PROVIDER_NOT_VERIFIED);
  });

  it('rejects without machine existing', () => {
    const session = pendingSession();
    const result = activateRunningSession(session, ctx({ machineExists: false }));
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.MACHINE_NOT_LINKED);
  });

  it('rejects activate from running state', () => {
    const session = runningSession();
    const result = activateRunningSession(session, ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.SESSION_NOT_PENDING);
  });

  it('rejects activate from closed state', () => {
    const session = closedSession();
    const result = activateRunningSession(session, ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.SESSION_NOT_PENDING);
  });
});

describe('closeSession (running -> closed)', () => {
  it('closes a running session after provider destroyed verified', () => {
    const session = runningSession();
    const result = closeSession(session, ctx({ providerDestroyedVerified: true }));
    assert.equal(result.state, 'OK');
    assert.equal(result.session.status, SESSION_STATUS.CLOSED);
    assert.equal(result.session.ended_at, NOW);
    assert.equal(result.session.verified_destroyed_at, NOW);
    assert.equal(result.session.settlement_status, SETTLEMENT_STATUS.PENDING);
    assert.equal(result.event, SESSION_DOMAIN_EVENT.SESSION_CLOSED);
  });

  it('records destroy_reason when provided', () => {
    const session = runningSession();
    const result = closeSession(session, ctx(), { destroyReason: 'user' });
    assert.equal(result.state, 'OK');
    assert.equal(result.session.destroy_reason, 'user');
  });

  it('rejects close without provider destroyed verify (OP-1)', () => {
    const session = runningSession();
    const result = closeSession(session, ctx({ providerDestroyedVerified: false }));
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.PROVIDER_NOT_VERIFIED);
  });

  it('rejects close from pending (not running)', () => {
    const session = pendingSession();
    const result = closeSession(session, ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.SESSION_NOT_RUNNING);
  });

  it('ignores duplicate close on already closed session', () => {
    const session = closedSession();
    const result = closeSession(session, ctx());
    assert.equal(result.state, 'IGNORED');
  });

  it('rejects close when machine not linked', () => {
    const session = {
      ...runningSession(),
      machineId: null,
    };
    const result = closeSession(session, ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.MACHINE_NOT_LINKED);
  });
});

describe('settlement sub-state', () => {
  it('happy path settlement flow', () => {
    let session = closedSession();
    assert.equal(
      startSettlement(session, ctx()).session.settlement_status,
      SETTLEMENT_STATUS.IN_PROGRESS,
    );
    session = startSettlement(session, ctx()).session;
    assert.equal(
      completeSettlement(session, ctx()).session.settlement_status,
      SETTLEMENT_STATUS.SETTLED,
    );
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

  it('rejects retry when settlement not failed', () => {
    const session = closedSession();
    const result = retrySettlement(session, ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.SETTLEMENT_NOT_FAILED);
  });

  it('skip settlement', () => {
    const session = closedSession();
    const result = skipSettlement(session, ctx());
    assert.equal(result.state, 'OK');
    assert.equal(result.session.settlement_status, SETTLEMENT_STATUS.SKIPPED);
  });

  it('startSettlement rejects from non-closed state', () => {
    const session = runningSession();
    const result = startSettlement(session, ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.SESSION_NOT_CLOSED);
  });

  it('settlement stays within closed status (no status mutation)', () => {
    let session = closedSession();
    session = startSettlement(session, ctx()).session;
    session = failSettlement(session, ctx()).session;
    session = retrySettlement(session, ctx()).session;
    session = completeSettlement(session, ctx()).session;
    assert.equal(session.status, SESSION_STATUS.CLOSED);
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

  it('assertSessionIntegrity throws on closed without settlement_status', () => {
    assert.throws(
      () =>
        assertSessionIntegrity({
          id: 'x',
          userId: 'u',
          status: SESSION_STATUS.CLOSED,
          ended_at: NOW,
          settlement_status: null,
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
    let session = runningSession();
    session = {
      ...session,
      ended_at: '2026-01-01T00:00:00.000Z',
    };
    assert.throws(
      () => closeSession(session, ctx(), { ended_at: NOW }),
      SessionInvariantViolationError,
    );
  });

  it('isTerminalStatus is true only for closed', () => {
    assert.equal(isTerminalStatus(SESSION_STATUS.CLOSED), true);
    assert.equal(isTerminalStatus(SESSION_STATUS.PENDING), false);
    assert.equal(isTerminalStatus(SESSION_STATUS.RUNNING), false);
  });

  it('isScbStatus is true for the three SCB statuses', () => {
    assert.equal(isScbStatus(SESSION_STATUS.PENDING), true);
    assert.equal(isScbStatus(SESSION_STATUS.RUNNING), true);
    assert.equal(isScbStatus(SESSION_STATUS.CLOSED), true);
    assert.equal(isScbStatus('closing'), false);
    assert.equal(isScbStatus('interrupted'), false);
    assert.equal(isScbStatus('completed'), false);
  });
});

describe('full happy path lifecycle', () => {
  it('pending -> running -> closed -> settled', () => {
    let session = pendingSession();
    session = activateRunningSession(session, ctx()).session;
    session = closeSession(session, ctx()).session;
    session = startSettlement(session, ctx()).session;
    session = completeSettlement(session, ctx()).session;

    assert.equal(session.status, SESSION_STATUS.CLOSED);
    assert.equal(session.settlement_status, SETTLEMENT_STATUS.SETTLED);
    assert.ok(session.started_at);
    assert.ok(session.ended_at);
    assert.ok(session.verified_running_at);
    assert.ok(session.verified_destroyed_at);
  });
});

describe('illegal transitions', () => {
  it('returns INVALID_TRANSITION for unknown command', () => {
    const session = pendingSession();
    const result = executeCommand(session, 'UNKNOWN', ctx(), {});
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.INVALID_TRANSITION);
  });

  it('rejects closed -> activate (already terminal)', () => {
    const session = closedSession();
    const result = activateRunningSession(session, ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.SESSION_NOT_PENDING);
  });

  it('rejects legacy REQUEST_DESTROY command', () => {
    const session = runningSession();
    const result = executeCommand(session, 'REQUEST_DESTROY', ctx(), { destroyReason: 'user' });
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.INVALID_TRANSITION);
  });

  it('rejects legacy INTERRUPT command', () => {
    const session = runningSession();
    const result = executeCommand(session, 'INTERRUPT', ctx(), { reason: 'orphan' });
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.INVALID_TRANSITION);
  });

  it('rejects close on pending session with inferred SESSION_NOT_RUNNING', () => {
    const session = pendingSession();
    const result = closeSession(session, ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.SESSION_NOT_RUNNING);
  });
});
