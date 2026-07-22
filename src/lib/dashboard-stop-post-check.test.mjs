import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  STOP_POST_CHECK_COPY,
  evaluateStopPostCheckSnapshot,
  formatStopPostCheckSuccessToast,
} from './dashboard-stop-post-check.js';

describe('dashboard-stop-post-check', () => {
  it('confirmed only when idle and billing stopped', () => {
    assert.equal(
      evaluateStopPostCheckSnapshot({ phase: 'idle', billingStarted: false }),
      'confirmed',
    );
    assert.equal(
      evaluateStopPostCheckSnapshot({ phase: 'idle', billingStarted: true }),
      'pending',
    );
  });

  it('still_active when machine/session clearly live', () => {
    assert.equal(
      evaluateStopPostCheckSnapshot({ phase: 'running', billingStarted: true }),
      'still_active',
    );
    assert.equal(
      evaluateStopPostCheckSnapshot({ phase: 'opening', billingStarted: false }),
      'still_active',
    );
    assert.equal(
      evaluateStopPostCheckSnapshot({ phase: 'disconnected', billingStarted: true }),
      'still_active',
    );
  });

  it('pending while stopping / loading', () => {
    assert.equal(
      evaluateStopPostCheckSnapshot({ phase: 'stopping', billingStarted: true }),
      'pending',
    );
    assert.equal(evaluateStopPostCheckSnapshot({ phase: 'loading' }), 'pending');
  });

  it('success toast mentions confirmation', () => {
    assert.match(formatStopPostCheckSuccessToast(), /xác nhận/i);
    assert.match(formatStopPostCheckSuccessToast({ alreadyStopped: true }), /xác nhận/i);
    assert.ok(STOP_POST_CHECK_COPY.postCheckFailed.includes('tính giờ'));
  });
});
