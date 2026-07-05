import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REMAINING_STATE_OK } from './remaining-time.js';
import { buildBillingSessionView, resolveStatusBillingPhase } from './billing-session-view.js';

describe('billing-session-view', () => {
  it('planCardTotalHours prefers inventory package size over M2 pool', () => {
    const view = buildBillingSessionView({
      machineSessionPhase: 'running',
      remainingRead: {
        remaining: { state: REMAINING_STATE_OK, remainingHours: 20.1, totalEntitlementHours: 20.1 },
        walletBalance: 0,
      },
      planInventoryTotalHours: 110,
    });
    assert.equal(view.planCardTotalHours, 110);
    assert.equal(view.planCardRemainingHours, 20.1);
  });

  it('resolveStatusBillingPhase maps live status', () => {
    assert.equal(resolveStatusBillingPhase('running', null, true), 'running');
    assert.equal(resolveStatusBillingPhase('running', null, false), 'opening');
    assert.equal(resolveStatusBillingPhase('starting', { status: 'starting' }), 'opening');
  });
});
