import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DESTROY_PIPELINE_STEP,
  mapDestroyedVerifyOutcome,
  isDestroyVerifyRetryable,
  normalizePipelineDestroyReason,
  shouldRunBackup,
  machineHasBillableSession,
  isProvenDestroySession,
  sessionBelongsToMachineForDestroy,
  assertSettlementAfterVerify,
} from './destroy-pipeline-core.js';
import {
  PROVIDER_VERIFY_STATE,
  PROVIDER_VERIFY_OUTCOME,
} from './gpu/provider-verify.js';

describe('mapDestroyedVerifyOutcome', () => {
  it('maps verified destroyed', () => {
    const outcome = mapDestroyedVerifyOutcome({
      state: PROVIDER_VERIFY_STATE.OK,
      outcome: PROVIDER_VERIFY_OUTCOME.VERIFIED_DESTROYED,
      snapshot: { normalizedState: 'destroyed' },
    });
    assert.equal(outcome, 'destroyed');
  });

  it('maps still running', () => {
    const outcome = mapDestroyedVerifyOutcome({
      state: PROVIDER_VERIFY_STATE.FAILED,
      outcome: PROVIDER_VERIFY_OUTCOME.VERIFY_FAILED,
      snapshot: { normalizedState: 'running' },
    });
    assert.equal(outcome, 'still_running');
  });

  it('maps unknown on timeout', () => {
    const outcome = mapDestroyedVerifyOutcome({
      state: PROVIDER_VERIFY_STATE.UNKNOWN,
      outcome: PROVIDER_VERIFY_OUTCOME.UNKNOWN,
      snapshot: null,
    });
    assert.equal(outcome, 'unknown');
    assert.equal(isDestroyVerifyRetryable(outcome), true);
  });
});

describe('pipeline helpers', () => {
  it('normalizes destroy reason', () => {
    assert.equal(normalizePipelineDestroyReason('idle_timeout'), 'idle_timeout');
    assert.equal(normalizePipelineDestroyReason(''), 'user_stop');
  });

  it('shouldRunBackup only for running machine with reason', () => {
    assert.equal(shouldRunBackup({ status: 'running' }, { reason: 'user_stop' }), true);
    assert.equal(shouldRunBackup({ status: 'running' }, { skipBackup: true, reason: 'user_stop' }), false);
    assert.equal(shouldRunBackup({ status: 'starting' }, { reason: 'user_stop' }), false);
  });

  it('machineHasBillableSession requires session anchor', () => {
    assert.equal(machineHasBillableSession({ gpu_session_id: 's', billing_started_at: 't' }), true);
    assert.equal(machineHasBillableSession({ gpu_session_id: 's' }), false);
  });

  it('isProvenDestroySession accepts running session linked to machine without billing anchor', () => {
    const machine = {
      id: 'm1',
      created_at: '2026-01-01T10:00:00.000Z',
    };
    const session = {
      id: 's1',
      machine_id: 'm1',
      status: 'running',
      started_at: '2026-01-01T10:00:05.000Z',
    };
    assert.equal(sessionBelongsToMachineForDestroy(session, machine), true);
    assert.equal(isProvenDestroySession(session, machine), true);
    assert.equal(isProvenDestroySession({ ...session, status: 'pending' }, machine), false);
    assert.equal(
      isProvenDestroySession({ ...session, machine_id: 'other' }, machine),
      false,
    );
  });

  it('T8 — settlement must follow verify in step trace', () => {
    assert.equal(
      assertSettlementAfterVerify([
        DESTROY_PIPELINE_STEP.VERIFY_DESTROYED,
        DESTROY_PIPELINE_STEP.SESSION_CLOSED,
        DESTROY_PIPELINE_STEP.SETTLEMENT,
      ]),
      true,
    );
    assert.equal(
      assertSettlementAfterVerify([
        DESTROY_PIPELINE_STEP.SETTLEMENT,
        DESTROY_PIPELINE_STEP.VERIFY_DESTROYED,
      ]),
      false,
    );
  });
});
