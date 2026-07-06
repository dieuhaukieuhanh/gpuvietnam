import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REMAINING_STATE_OK } from './remaining-time.js';
import { resolvePlanCardHours } from '../plan-card-display.js';
import { buildBillingSessionView, resolveStatusBillingPhase, shouldUseMachineRemainingRead } from './billing-session-view.js';

describe('billing-session-view', () => {
  it('planCardTotalHours prefers inventory package size over subscription fallback', () => {
    const view = buildBillingSessionView({
      machineSessionPhase: 'running',
      remainingRead: {
        remaining: { state: REMAINING_STATE_OK, remainingHours: 20.1, totalEntitlementHours: 20.1 },
        walletBalance: 0,
      },
      planInventoryTotalHours: 110,
      subscriptionPackageHours: 230,
    });
    assert.equal(view.planCardTotalHours, 110);
    assert.equal(view.planCardRemainingHours, 20.1);
  });

  it('planCardTotalHours uses subscription package hours not M2 entitlement pool', () => {
    const view = buildBillingSessionView({
      remainingRead: {
        remaining: { state: REMAINING_STATE_OK, remainingHours: 20.1, totalEntitlementHours: 20.1 },
      },
      subscriptionPackageHours: 110,
    });
    assert.equal(view.planCardTotalHours, 110);
  });

  it('planCardTotalHours stays null without inventory or subscription package hours', () => {
    const view = buildBillingSessionView({
      remainingRead: {
        remaining: { state: REMAINING_STATE_OK, remainingHours: 20.1, totalEntitlementHours: 20.1 },
      },
    });
    assert.equal(view.planCardTotalHours, null);
  });

  it('resolvePlanCardHours prefers billingView remaining over inventory', () => {
    const hours = resolvePlanCardHours({
      inventoryHoursRemaining: 25,
      inventoryHoursTotal: 110,
      subscriptionPackageHours: 110,
      billingView: { planCardRemainingHours: 20.1, planCardTotalHours: 110 },
    });
    assert.equal(hours.hoursRemaining, 20.1);
    assert.equal(hours.hoursTotal, 110);
  });

  it('resolveStatusBillingPhase maps live status', () => {
    assert.equal(resolveStatusBillingPhase('running', null, true), 'running');
    assert.equal(resolveStatusBillingPhase('running', null, false), 'opening');
    assert.equal(resolveStatusBillingPhase('starting', { status: 'starting' }), 'opening');
  });

  it('shouldUseMachineRemainingRead during opening when billing anchored', () => {
    const machine = { status: 'running', billing_started_at: '2026-07-03T10:00:05.000Z' };
    assert.equal(shouldUseMachineRemainingRead(machine, 'opening'), true);
    assert.equal(shouldUseMachineRemainingRead(machine, 'idle'), false);
    assert.equal(shouldUseMachineRemainingRead({ status: 'running' }, 'opening'), false);
  });
});
