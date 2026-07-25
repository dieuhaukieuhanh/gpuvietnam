import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  createPendingSession,
  SESSION_ERROR_CODE,
} from './session-lifecycle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-07-25T12:00:00.000Z';

/**
 * Adapter branch under test (Patch A): honor Domain TransitionResult.state.
 * Mirrors createProvisioningPendingSession after createPendingSession returns.
 * @param {{ state?: string, message?: string, code?: string }} pendingResult
 */
function decideProvisioningPersist(pendingResult) {
  if (pendingResult.state === 'ERROR') {
    return {
      skipped: true,
      reason: pendingResult.message ?? 'create_pending_failed',
      code: pendingResult.code ?? null,
    };
  }
  return { persist: true };
}

function domainOkPending() {
  return createPendingSession(
    { id: 'sess-ok', userId: 'u1', machineId: 'm1', created_at: NOW },
    { subscriptionActive: true, otherRunningSessionCount: 0, now: NOW },
  );
}

function domainErrorPending() {
  return createPendingSession(
    { id: 'sess-err', userId: 'u1', machineId: 'm1', created_at: NOW },
    { subscriptionActive: true, otherRunningSessionCount: 1, now: NOW },
  );
}

describe('Patch A — createProvisioningPendingSession Domain result contract', () => {
  it('Domain OK has state OK and no ok:true (legacy !pendingResult.ok is always true)', () => {
    const result = domainOkPending();
    assert.equal(result.state, 'OK');
    assert.equal(result.ok, undefined);
    // Proves why !pendingResult.ok was wrong: it treats OK as failure.
    assert.equal(!result.ok, true);
  });

  it('Domain OK → adapter persists (state === ERROR is false)', () => {
    const result = domainOkPending();
    const decision = decideProvisioningPersist(result);
    assert.deepEqual(decision, { persist: true });
  });

  it('Domain ERROR → adapter skips (no persist)', () => {
    const result = domainErrorPending();
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.MULTIPLE_RUNNING_SESSIONS);
    const decision = decideProvisioningPersist(result);
    assert.equal(decision.skipped, true);
    assert.equal(decision.persist, undefined);
    assert.ok(decision.reason);
  });

  it('createProvisioningPendingSession source uses pendingResult.state === ERROR (not !ok)', () => {
    const source = readFileSync(join(__dirname, 'session-start.js'), 'utf8');
    const fnStart = source.indexOf('export async function createProvisioningPendingSession');
    assert.ok(fnStart >= 0);
    const fnEnd = source.indexOf('export async function interruptPendingSessionForUser', fnStart);
    const body = source.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined);

    assert.ok(
      body.includes('pendingResult.state === \'ERROR\'') ||
        body.includes('pendingResult.state === "ERROR"'),
      'must branch on TransitionResult.state',
    );
    assert.equal(
      body.includes('!pendingResult.ok'),
      false,
      'must not use legacy !pendingResult.ok',
    );
    // Persist path: insert follows the ERROR early-return.
    const errorIdx = body.search(/pendingResult\.state\s*===\s*['"]ERROR['"]/);
    const insertIdx = body.indexOf(".insert(");
    assert.ok(errorIdx >= 0 && insertIdx > errorIdx, 'insert must run only after ERROR check');
  });
});
