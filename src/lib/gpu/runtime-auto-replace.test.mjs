import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RUNTIME_REPLACE_UX_MESSAGE,
  evaluateRuntimeAutoReplaceEligibility,
  runtimeAutoReplaceIdempotencyKey,
} from './runtime-auto-replace-core.js';
import { shouldKeepBillingSessionOpenOnRuntimeDead } from './billing-session-p0b.js';
import {
  MACHINE_OPERATION,
  priorityForOperation,
} from '../infrastructure/machine-operation-core.js';
import { getRetryPolicy } from '../infrastructure/machine-operation-policies.js';

const OPEN = {
  status: 'running',
  started_at: '2026-07-24T17:00:00.000Z',
  close_requested_at: null,
  ended_at: null,
};

describe('P1 runtime auto-replace policy', () => {
  it('UX copy matches product freeze', () => {
    assert.equal(
      RUNTIME_REPLACE_UX_MESSAGE,
      'Generate tạm gián đoạn — Phiên vẫn làm việc bình thường',
    );
  });

  it('nên thay: phiên billable OPEN + GPU chết', () => {
    assert.equal(shouldKeepBillingSessionOpenOnRuntimeDead(OPEN), true);
    const d = evaluateRuntimeAutoReplaceEligibility(OPEN);
    assert.equal(d.allow, true);
    assert.equal(d.reason, 'open_billable_runtime_dead');
  });

  it('không thay: user đóng phiên', () => {
    const d = evaluateRuntimeAutoReplaceEligibility({
      ...OPEN,
      close_requested_at: '2026-07-24T18:00:00.000Z',
    });
    assert.equal(d.allow, false);
    assert.equal(d.reason, 'user_or_policy_close');
  });

  it('không thay: phiên chưa sẵn sàng / chưa billable', () => {
    assert.equal(
      evaluateRuntimeAutoReplaceEligibility({ status: 'pending', started_at: null }).reason,
      'session_not_ready',
    );
    assert.equal(
      evaluateRuntimeAutoReplaceEligibility({
        status: 'running',
        started_at: null,
      }).reason,
      'session_not_ready',
    );
  });

  it('không thay: không có phiên / đã đóng', () => {
    assert.equal(evaluateRuntimeAutoReplaceEligibility(null).reason, 'no_session');
    assert.equal(
      evaluateRuntimeAutoReplaceEligibility({ status: 'closed', started_at: OPEN.started_at })
        .reason,
      'session_closed',
    );
  });

  it('không thay: hết giờ / hết tiền / policy stop', () => {
    assert.equal(
      evaluateRuntimeAutoReplaceEligibility(OPEN, { outOfCredit: true }).reason,
      'out_of_credit',
    );
    assert.equal(
      evaluateRuntimeAutoReplaceEligibility(OPEN, { policyStopRequested: true }).reason,
      'user_or_policy_close',
    );
  });

  it('không thay: đang replace / hết retry / đã có máy khỏe', () => {
    assert.equal(
      evaluateRuntimeAutoReplaceEligibility(OPEN, { hasActiveReplaceOp: true }).reason,
      'replace_already_in_flight',
    );
    assert.equal(
      evaluateRuntimeAutoReplaceEligibility(OPEN, {
        replaceDeadLetteredForMachine: true,
      }).reason,
      'replace_retries_exhausted',
    );
    assert.equal(
      evaluateRuntimeAutoReplaceEligibility(OPEN, {
        hasHealthyActiveMachineForSession: true,
      }).reason,
      'session_already_has_healthy_machine',
    );
  });

  it('idempotency key is per user+session+dead machine (multi-replace OK)', () => {
    assert.equal(
      runtimeAutoReplaceIdempotencyKey('u1', 's1', 'm1'),
      'runtime_auto_replace:u1:s1:m1',
    );
    assert.notEqual(
      runtimeAutoReplaceIdempotencyKey('u1', 's1', 'm1'),
      runtimeAutoReplaceIdempotencyKey('u1', 's1', 'm2'),
    );
  });

  it('operation is registered with recover priority and retry policy', () => {
    assert.equal(MACHINE_OPERATION.RUNTIME_AUTO_REPLACE, 'runtime_auto_replace');
    assert.ok(
      priorityForOperation(MACHINE_OPERATION.RUNTIME_AUTO_REPLACE) >
        priorityForOperation(MACHINE_OPERATION.PROJECTION_VERIFY),
    );
    const policy = getRetryPolicy('runtime_auto_replace');
    assert.equal(policy.maxAttempts, 3);
  });
});
