import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MACHINE_OPERATION_RETRY_POLICIES,
  PRIORITY_CLASS,
  getRetryPolicy,
  hasExhaustedRetryPolicy,
  priorityForOperation,
  resolveRetryAfterFailure,
  resolveProviderFromMachine,
} from './machine-operation-policies.js';

describe('machine-operation-policies (Phase 2.5)', () => {
  it('default_drift retry delays match spec', () => {
    const policy = getRetryPolicy('default_drift');
    assert.deepEqual(policy.delaysMs, [5_000, 20_000, 60_000, 300_000]);
    assert.equal(policy.maxAttempts, 5);
  });

  it('resolveRetryAfterFailure schedules 5s after attempt 1', () => {
    const now = new Date('2026-07-05T10:00:00.000Z');
    const result = resolveRetryAfterFailure('default_drift', 1, now);
    assert.equal(result.deadLetter, false);
    assert.equal(result.delayMs, 5_000);
    assert.equal(result.nextRetryAt.toISOString(), '2026-07-05T10:00:05.000Z');
  });

  it('resolveRetryAfterFailure dead letters at attempt 5', () => {
    const result = resolveRetryAfterFailure('default_drift', 5);
    assert.equal(result.deadLetter, true);
    assert.equal(result.failureReason, 'max_attempts_exceeded');
  });

  it('priority registry ranks destroy above repair', () => {
    assert.equal(priorityForOperation('drift_destroy_user_machine'), PRIORITY_CLASS.DESTROY);
    assert.equal(priorityForOperation('drift_update_subscription'), PRIORITY_CLASS.REPAIR);
    assert.ok(
      priorityForOperation('drift_destroy_user_machine') >
        priorityForOperation('drift_update_subscription'),
    );
  });

  it('hasExhaustedRetryPolicy uses central policy maxAttempts', () => {
    assert.equal(hasExhaustedRetryPolicy(4, 'default_drift'), false);
    assert.equal(hasExhaustedRetryPolicy(5, 'default_drift'), true);
  });

  it('resolveProviderFromMachine defaults to vast', () => {
    assert.equal(resolveProviderFromMachine(null), 'vast');
    assert.equal(resolveProviderFromMachine({ provider: 'vast' }), 'vast');
  });

  it('MACHINE_OPERATION_RETRY_POLICIES is the single config source', () => {
    assert.ok(MACHINE_OPERATION_RETRY_POLICIES.default_drift);
    assert.equal(Object.keys(MACHINE_OPERATION_RETRY_POLICIES).length >= 1, true);
  });

  it('PENDING_STALE_MS is exported for queue self-heal', async () => {
    const { PENDING_STALE_MS } = await import('./machine-operation-policies.js');
    assert.equal(PENDING_STALE_MS, 120_000);
  });
});
