import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BACKUP_RETENTION_STATE,
  computeBackupEntitlementSync,
  getBackupEntitlementForPlan,
  resolveEffectiveBackupPlanGb,
  resolveMaxBackupPlanKey,
} from './backup-entitlement.js';

describe('resolveMaxBackupPlanKey', () => {
  it('picks highest tier among many', () => {
    assert.equal(resolveMaxBackupPlanKey(['starter', 'Studio', 'pro']), 'studio');
  });

  it('returns null when empty', () => {
    assert.equal(resolveMaxBackupPlanKey([]), null);
  });
});

describe('resolveEffectiveBackupPlanGb', () => {
  it('uses max of entitled and upgrade', () => {
    assert.equal(resolveEffectiveBackupPlanGb(10, 50), 50);
    assert.equal(resolveEffectiveBackupPlanGb(100, 50), 100);
  });

  it('defaults to starter floor when both zero', () => {
    assert.equal(resolveEffectiveBackupPlanGb(0, 0), 100);
  });
});

describe('getBackupEntitlementForPlan', () => {
  it('maps tiers', () => {
    assert.deepEqual(getBackupEntitlementForPlan('starter'), {
      planKey: 'starter',
      planGb: 100,
      retentionDays: 30,
    });
    assert.equal(getBackupEntitlementForPlan('pro').planGb, 150);
    assert.equal(getBackupEntitlementForPlan('studio').planGb, 200);
    assert.equal(getBackupEntitlementForPlan('studio').retentionDays, 120);
  });
});

describe('computeBackupEntitlementSync', () => {
  const nowMs = Date.parse('2026-07-12T12:00:00.000Z');

  it('active user with Pro gets 150GB and ACTIVE', () => {
    const r = computeBackupEntitlementSync({
      inventoryRows: [
        { plan_name: 'starter', plan_type: 'combo', status: 'active', hours_remaining: 1 },
        { plan_name: 'pro', plan_type: 'combo', status: 'active', hours_remaining: 5 },
      ],
      upgradeGb: 0,
      currentState: 'active',
      nowMs,
    });
    assert.equal(r.hasCapacity, true);
    assert.equal(r.entitledPlanKey, 'pro');
    assert.equal(r.planGb, 150);
    assert.equal(r.state, BACKUP_RETENTION_STATE.ACTIVE);
    assert.equal(r.graceStartedAt, null);
  });

  it('upgrade pack raises limit above plan', () => {
    const r = computeBackupEntitlementSync({
      inventoryRows: [
        { plan_name: 'starter', plan_type: 'combo', status: 'active', hours_remaining: 2 },
      ],
      upgradeGb: 200,
      currentState: 'active',
      nowMs,
    });
    assert.equal(r.planGb, 200);
  });

  it('no hours enters GRACE with plan retention', () => {
    const r = computeBackupEntitlementSync({
      inventoryRows: [
        { plan_name: 'studio', plan_type: 'combo', status: 'depleted', hours_remaining: 0 },
      ],
      previousEntitledPlan: 'studio',
      upgradeGb: 0,
      currentState: 'active',
      nowMs,
    });
    assert.equal(r.hasCapacity, false);
    assert.equal(r.state, BACKUP_RETENTION_STATE.GRACE);
    assert.equal(r.entitledPlanKey, 'studio');
    assert.equal(r.planGb, 200);
    assert.equal(r.graceStartedAt, '2026-07-12T12:00:00.000Z');
    assert.equal(r.purgeAfter, '2026-11-09T12:00:00.000Z'); // +120d
  });

  it('keeps grace start and recalculates deadline when entitled shrinks', () => {
    const r = computeBackupEntitlementSync({
      inventoryRows: [],
      previousEntitledPlan: 'starter',
      upgradeGb: 0,
      currentState: 'grace',
      graceStartedAt: '2026-07-01T00:00:00.000Z',
      purgeAfter: '2026-10-29T00:00:00.000Z',
      nowMs,
    });
    assert.equal(r.state, BACKUP_RETENTION_STATE.GRACE);
    assert.equal(r.graceStartedAt, '2026-07-01T00:00:00.000Z');
    assert.equal(r.purgeAfter, '2026-07-31T00:00:00.000Z'); // +30d from start
  });

  it('capacity restores ACTIVE from grace', () => {
    const r = computeBackupEntitlementSync({
      inventoryRows: [
        { plan_name: 'pro', plan_type: 'combo', status: 'active', hours_remaining: 1 },
      ],
      currentState: 'grace',
      graceStartedAt: '2026-07-01T00:00:00.000Z',
      purgeAfter: '2026-09-29T00:00:00.000Z',
      previousEntitledPlan: 'pro',
      nowMs,
    });
    assert.equal(r.state, BACKUP_RETENTION_STATE.ACTIVE);
    assert.equal(r.graceStartedAt, null);
    assert.equal(r.purgeAfter, null);
  });

  it('hourly with wallet counts as capacity', () => {
    const r = computeBackupEntitlementSync({
      inventoryRows: [
        { plan_name: 'pro', plan_type: 'hourly', status: 'active', hours_remaining: 0 },
      ],
      walletBalance: 50_000,
      nowMs,
    });
    assert.equal(r.hasCapacity, true);
    assert.equal(r.entitledPlanKey, 'pro');
  });
});