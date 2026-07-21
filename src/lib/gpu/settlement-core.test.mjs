import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SETTLEMENT_ERROR_CODE,
  calculateBillableSeconds,
  compareSettlementPlanPriority,
  settlementPlanTier,
  computeAvailableEntitlementSeconds,
  capChargeSeconds,
  allocateSettlementCharge,
  buildSettlementBreakdown,
  evaluateSettlementEligibility,
  orderPlansForSettlement,
} from './settlement-core.js';

describe('calculateBillableSeconds', () => {
  it('T1 — derives from ended_at − started_at (3600s)', () => {
    const started = '2026-01-01T10:00:00.000Z';
    const ended = '2026-01-01T11:00:00.000Z';
    assert.equal(calculateBillableSeconds(started, ended), 3600);
  });

  it('T8 — billable 0 when ended equals started', () => {
    const t = '2026-01-01T10:00:00.000Z';
    assert.equal(calculateBillableSeconds(t, t), 0);
  });

  it('never uses duration_seconds field', () => {
    assert.equal(calculateBillableSeconds('2026-01-01T10:00:00.000Z', null), 0);
  });
});

describe('consumption order', () => {
  const nowMs = Date.parse('2026-07-19T12:00:00.000Z');
  const manualGrant = {
    id: 1,
    plan_type: 'gift',
    grant_id: 10,
    hours_remaining: 5,
    status: 'active',
    valid_until: '2026-10-01T00:00:00.000Z',
  };
  const gift = {
    id: 2,
    plan_type: 'gift',
    hours_remaining: 5,
    status: 'active',
    valid_until: '2026-09-01T00:00:00.000Z',
  };
  const combo1 = {
    id: 3,
    plan_type: 'combo',
    billing: 'combo1',
    hours_remaining: 5,
    status: 'active',
    valid_until: '2026-08-01T00:00:00.000Z',
  };
  const combo2 = {
    id: 5,
    plan_type: 'combo',
    billing: 'combo2',
    hours_remaining: 5,
    status: 'active',
    valid_until: '2026-12-01T00:00:00.000Z',
  };
  const hourly = {
    id: 4,
    plan_type: 'hourly',
    billing: 'hourly',
    price_per_hour: 10000,
    hours_remaining: 5,
    status: 'active',
    valid_until: '2026-07-25T00:00:00.000Z',
  };

  it('T5 — soonest valid_until first across gift / hourly / combo', () => {
    const ordered = orderPlansForSettlement(
      [combo2, combo1, hourly, gift, manualGrant],
      nowMs,
    );
    assert.deepEqual(ordered.map((p) => p.id), [4, 3, 2, 1, 5]);
    assert.ok(compareSettlementPlanPriority(hourly, combo1) < 0);
    assert.ok(compareSettlementPlanPriority(combo1, gift) < 0);
    assert.ok(compareSettlementPlanPriority(gift, manualGrant) < 0);
    assert.ok(compareSettlementPlanPriority(manualGrant, combo2) < 0);
    // Legacy helper still classifies plan types (not used for burn order).
    assert.equal(settlementPlanTier(manualGrant), 0);
    assert.equal(settlementPlanTier(combo2), 4);
  });

  it('T5 — soonest expiry wins across different plan types', () => {
    const soonCombo = {
      id: 10,
      plan_type: 'combo',
      billing: 'combo2',
      hours_remaining: 2,
      status: 'active',
      valid_until: '2026-08-01T00:00:00.000Z',
    };
    const laterGift = {
      id: 11,
      plan_type: 'gift',
      hours_remaining: 2,
      status: 'active',
      valid_until: '2026-09-01T00:00:00.000Z',
    };
    const ordered = orderPlansForSettlement([laterGift, soonCombo], nowMs);
    assert.deepEqual(ordered.map((p) => p.id), [10, 11]);
  });

  it('T5 — burns by expiry order (combo before later gift/hourly)', () => {
    const allocation = allocateSettlementCharge({
      chargeSeconds: 10800,
      plans: [
        {
          id: 3,
          plan_type: 'combo',
          billing: 'combo1',
          hours_remaining: 1,
          status: 'active',
          valid_until: '2026-08-01T00:00:00.000Z',
        },
        {
          id: 4,
          plan_type: 'hourly',
          billing: 'hourly',
          hours_remaining: 1,
          status: 'active',
          subscription_id: 'h1',
          valid_until: '2026-10-01T00:00:00.000Z',
        },
        {
          id: 2,
          plan_type: 'gift',
          hours_remaining: 1,
          status: 'active',
          valid_until: '2026-09-01T00:00:00.000Z',
        },
      ],
      walletBalance: 0,
      nowMs,
    });
    assert.equal(allocation.lines.length, 3);
    assert.equal(allocation.lines[0].source, 'combo');
    assert.equal(allocation.lines[0].inventoryId, 3);
    assert.equal(allocation.lines[1].source, 'gift');
    assert.equal(allocation.lines[2].subscriptionId, 'h1');
    assert.equal(allocation.chargedSeconds, 10800);
  });

  it('sooner gift burns before later manual grant', () => {
    const allocation = allocateSettlementCharge({
      chargeSeconds: 3600,
      plans: [gift, manualGrant],
      walletBalance: 0,
      nowMs,
    });
    assert.equal(allocation.lines[0].source, 'gift');
    assert.equal(allocation.lines[0].inventoryId, 2);
  });
});

describe('cap and wallet partial', () => {
  it('T6 — caps charge at available entitlement', () => {
    const plans = [{ id: 1, plan_type: 'gift', hours_remaining: 0.5, status: 'active' }];
    const available = computeAvailableEntitlementSeconds(plans, 0);
    const capped = capChargeSeconds(7200, available);
    assert.equal(available, 1800);
    assert.equal(capped.chargeSeconds, 1800);
    assert.equal(capped.capAppliedSeconds, 5400);
  });

  it('T6 — hourly burns prepaid hours before wallet', () => {
    const plans = [
      {
        id: 1,
        plan_type: 'hourly',
        price_per_hour: 10000,
        hours_remaining: 1,
        subscription_id: 'sub-1',
        status: 'active',
      },
    ];
    const allocation = allocateSettlementCharge({
      chargeSeconds: 7200,
      plans,
      walletBalance: 20000,
    });
    assert.equal(allocation.lines.length, 2);
    assert.equal(allocation.lines[0].source, 'combo');
    assert.equal(allocation.lines[0].hours, 1);
    assert.equal(allocation.lines[0].subscriptionId, 'sub-1');
    assert.equal(allocation.lines[1].source, 'wallet');
    assert.equal(allocation.lines[1].hours, 1);
    assert.equal(allocation.chargedSeconds, 7200);
  });

  it('T6 — hourly wallet partial at balance', () => {
    const plans = [{ id: 1, plan_type: 'hourly', price_per_hour: 10000, status: 'active' }];
    const allocation = allocateSettlementCharge({
      chargeSeconds: 7200,
      plans,
      walletBalance: 5000,
    });
    assert.equal(allocation.lines.length, 1);
    assert.equal(allocation.lines[0].source, 'wallet');
    assert.equal(allocation.lines[0].walletVnd, 5000);
    assert.equal(allocation.chargedSeconds, 1800);
    assert.equal(allocation.unchargedSeconds, 5400);
  });
});

describe('buildSettlementBreakdown', () => {
  it('produces audit JSON shape', () => {
    const breakdown = buildSettlementBreakdown({
      sessionId: 'sess-1',
      billableSeconds: 3600,
      chargeSeconds: 3600,
      unchargedSeconds: 0,
      capAppliedSeconds: null,
      lines: [
        { source: 'gift', seconds: 3600, hours: 1 },
        { source: 'wallet', seconds: 0, hours: 0, walletVnd: 0 },
      ],
    });
    assert.equal(breakdown.session_id, 'sess-1');
    assert.equal(breakdown.billable_seconds, 3600);
    assert.equal(breakdown.gift.hours, 1);
    assert.equal(breakdown.wallet.vnd, 0);
    assert.equal(breakdown.cap_applied_seconds, null);
  });
});

describe('evaluateSettlementEligibility', () => {
  const baseSession = {
    status: 'closed',
    started_at: '2026-01-01T10:00:00.000Z',
    ended_at: '2026-01-01T11:00:00.000Z',
    verified_destroyed_at: '2026-01-01T11:00:05.000Z',
    settlement_status: 'pending',
  };

  it('T3 — rejects when verify not destroyed', () => {
    const result = evaluateSettlementEligibility(
      { ...baseSession, verified_destroyed_at: null },
      { providerDestroyedVerified: false },
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, SETTLEMENT_ERROR_CODE.VERIFY_NOT_DESTROYED);
  });

  it('accepts when providerDestroyedVerified flag set', () => {
    const result = evaluateSettlementEligibility(
      { ...baseSession, verified_destroyed_at: null },
      { providerDestroyedVerified: true },
    );
    assert.equal(result.ok, true);
  });

  it('rejects running session', () => {
    const result = evaluateSettlementEligibility({ ...baseSession, status: 'running' });
    assert.equal(result.code, SETTLEMENT_ERROR_CODE.SESSION_NOT_CLOSED);
  });

  it('rejects already settled', () => {
    const result = evaluateSettlementEligibility({
      ...baseSession,
      settlement_status: 'settled',
    });
    assert.equal(result.code, SETTLEMENT_ERROR_CODE.ALREADY_SETTLED);
  });
});
