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
  const manualGrant = { id: 1, plan_type: 'gift', grant_id: 10, hours_remaining: 5, status: 'active' };
  const gift = { id: 2, plan_type: 'gift', hours_remaining: 5, status: 'active' };
  const combo = { id: 3, plan_type: 'combo', hours_remaining: 5, status: 'active' };
  const hourly = { id: 4, plan_type: 'hourly', price_per_hour: 10000, status: 'active' };

  it('T5 — manual grant before gift before combo before hourly', () => {
    const ordered = orderPlansForSettlement([hourly, combo, gift, manualGrant]);
    assert.deepEqual(ordered.map((p) => p.id), [1, 2, 3, 4]);
    assert.equal(settlementPlanTier(manualGrant), 0);
    assert.equal(settlementPlanTier(gift), 1);
    assert.equal(settlementPlanTier(combo), 2);
    assert.equal(settlementPlanTier(hourly), 3);
    assert.ok(compareSettlementPlanPriority(manualGrant, gift) < 0);
    assert.ok(compareSettlementPlanPriority(gift, combo) < 0);
    assert.ok(compareSettlementPlanPriority(combo, hourly) < 0);
  });

  it('T5 — gift consumed before combo in allocation', () => {
    const allocation = allocateSettlementCharge({
      chargeSeconds: 7200,
      plans: [
        { id: 3, plan_type: 'combo', hours_remaining: 1, status: 'active' },
        { id: 2, plan_type: 'gift', hours_remaining: 1, status: 'active' },
      ],
      walletBalance: 0,
    });
    assert.equal(allocation.lines.length, 2);
    assert.equal(allocation.lines[0].source, 'gift');
    assert.equal(allocation.lines[1].source, 'combo');
    assert.equal(allocation.chargedSeconds, 7200);
  });

  it('manual grant consumed before gift', () => {
    const allocation = allocateSettlementCharge({
      chargeSeconds: 3600,
      plans: [gift, manualGrant],
      walletBalance: 0,
    });
    assert.equal(allocation.lines[0].source, 'manual_grant');
    assert.equal(allocation.lines[0].grantId, 10);
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
