import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RUNTIME_REPLACE_UX_MESSAGE,
} from './runtime-auto-replace-core.js';
import { shouldKeepBillingSessionOpenOnRuntimeDead } from './billing-session-p0b.js';
import {
  runtimeAutoReplaceIdempotencyKey,
} from '../infrastructure/enqueue-runtime-auto-replace.js';
import {
  MACHINE_OPERATION,
  priorityForOperation,
} from '../infrastructure/machine-operation-core.js';
import { getRetryPolicy } from '../infrastructure/machine-operation-policies.js';

describe('P1 runtime auto-replace', () => {
  it('UX copy matches product freeze', () => {
    assert.equal(
      RUNTIME_REPLACE_UX_MESSAGE,
      'Generate tạm gián đoạn — Phiên vẫn làm việc bình thường',
    );
  });

  it('open billable session blocks settle-on-dead', () => {
    assert.equal(
      shouldKeepBillingSessionOpenOnRuntimeDead({
        status: 'running',
        started_at: '2026-07-24T17:00:00.000Z',
      }),
      true,
    );
  });

  it('idempotency key is per user+session', () => {
    assert.equal(
      runtimeAutoReplaceIdempotencyKey('u1', 's1'),
      'runtime_auto_replace:open:u1:s1',
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
