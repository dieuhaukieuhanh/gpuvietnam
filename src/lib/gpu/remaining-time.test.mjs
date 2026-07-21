import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  REMAINING_ERROR_MULTIPLE_RUNNING_SESSIONS,
  REMAINING_INVALID_STATE,
  REMAINING_STATE_OK,
  RemainingInvariantError,
  calculateCurrentSessionElapsed,
  calculateRemaining,
  calculateSessionBillableSeconds,
  calculateSettledUsage,
  calculateTotalEntitlement,
  clampRemainingHours,
  createClock,
  filterEntitlementPlansForMachine,
  isOutOfCredit,
  normalizeEntitlementPlanKey,
  resolveMachinePlanKey,
  selectPrimaryBillablePlanForMachine,
} from './remaining-time.js';

const T0 = '2026-06-28T10:00:00.000Z';
const clock = createClock(T0);

describe('calculateTotalEntitlement', () => {
  it('returns 0 when no entitlement', () => {
    assert.equal(calculateTotalEntitlement({ entitlementPlans: [], walletBalance: 0 }, clock), 0);
  });

  it('sums gift and combo hours', () => {
    const snapshot = {
      entitlementPlans: [
        { status: 'active', plan_type: 'gift', hours_remaining: 2 },
        { status: 'active', plan_type: 'combo', hours_remaining: 3 },
      ],
      walletBalance: 0,
    };
    assert.equal(calculateTotalEntitlement(snapshot, clock), 5);
  });

  it('excludes expired gift', () => {
    const snapshot = {
      entitlementPlans: [
        {
          status: 'active',
          plan_type: 'gift',
          hours_remaining: 10,
          valid_until: '2026-06-27T00:00:00.000Z',
        },
      ],
      walletBalance: 0,
    };
    assert.equal(calculateTotalEntitlement(snapshot, clock), 0);
  });

  it('includes wallet hours when hourly plan active (full precision)', () => {
    const snapshot = {
      entitlementPlans: [
        { status: 'active', plan_type: 'hourly', price_per_hour: 30000, hours_remaining: 0 },
      ],
      walletBalance: 100000,
    };
    assert.equal(calculateTotalEntitlement(snapshot, clock), 100000 / 30000);
  });

  it('when machine is set, only counts hours for that package (not other plans)', () => {
    const snapshot = {
      machine: { gpu_line: 'rtx3090', billing_inventory_id: 1 },
      entitlementPlans: [
        { id: 1, status: 'active', plan_type: 'combo', plan_name: 'starter', hours_remaining: 0.4 },
        { id: 2, status: 'active', plan_type: 'combo', plan_name: 'pro', hours_remaining: 50 },
      ],
      walletBalance: 0,
    };
    assert.equal(calculateTotalEntitlement(snapshot, clock), 0.4);
  });
});

describe('plan key helpers', () => {
  it('normalizeEntitlementPlanKey maps starter/pro/studio', () => {
    assert.equal(normalizeEntitlementPlanKey('Starter'), 'starter');
    assert.equal(normalizeEntitlementPlanKey('pro'), 'pro');
    assert.equal(normalizeEntitlementPlanKey('Studio 2x'), 'studio');
  });

  it('resolveMachinePlanKey prefers billing inventory row', () => {
    const key = resolveMachinePlanKey(
      { billing_inventory_id: 2, gpu_line: 'rtx3090' },
      [
        { id: 1, plan_name: 'starter' },
        { id: 2, plan_name: 'pro' },
      ],
    );
    assert.equal(key, 'pro');
  });

  it('resolveMachinePlanKey prefers subscription when inventory is another package', () => {
    const key = resolveMachinePlanKey(
      {
        billing_inventory_id: 15,
        subscription_id: 'sub-pro',
        gpu_line: 'rtx4090_1x',
      },
      [
        { id: 15, plan_name: 'starter', subscription_id: 'sub-starter' },
        { id: 21, plan_name: 'pro', subscription_id: 'sub-pro' },
      ],
    );
    assert.equal(key, 'pro');
  });

  it('selectPrimaryBillablePlanForMachine scopes soonest-expiry burn to package', () => {
    // Global order may put Starter first; must not pick it for a Pro machine.
    const picked = selectPrimaryBillablePlanForMachine(
      [
        {
          id: 15,
          plan_name: 'starter',
          plan_type: 'gift',
          valid_until: '2026-08-01T00:00:00.000Z',
        },
        {
          id: 22,
          plan_name: 'pro',
          plan_type: 'gift',
          valid_until: '2026-09-01T00:00:00.000Z',
        },
        {
          id: 21,
          plan_name: 'pro',
          plan_type: 'combo',
          billing: 'combo2',
          is_active: true,
          valid_until: '2026-12-01T00:00:00.000Z',
        },
      ],
      { billing_inventory_id: 15, subscription_id: 'sub-pro', gpu_line: 'rtx4090_1x' },
      { plan: 'Pro' },
    );
    assert.equal(Number(picked?.id), 22);
  });

  it('filterEntitlementPlansForMachine keeps only matching package', () => {
    const filtered = filterEntitlementPlansForMachine(
      [
        { id: 1, plan_name: 'starter', hours_remaining: 1 },
        { id: 2, plan_name: 'pro', hours_remaining: 9 },
      ],
      { gpu_line: 'rtx3090' },
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].plan_name, 'starter');
  });
});

describe('calculateSettledUsage', () => {
  it('sums only settlement_status=settled sessions', () => {
    const snapshot = {
      sessions: [
        {
          status: 'closed',
          settlement_status: 'settled',
          started_at: '2026-06-28T08:00:00.000Z',
          ended_at: '2026-06-28T10:00:00.000Z',
        },
        {
          status: 'closed',
          settlement_status: 'failed',
          started_at: '2026-06-28T06:00:00.000Z',
          ended_at: '2026-06-28T07:00:00.000Z',
        },
        {
          status: 'interrupted',
          settlement_status: 'skipped',
          started_at: '2026-06-28T04:00:00.000Z',
          ended_at: '2026-06-28T05:00:00.000Z',
        },
      ],
    };
    assert.equal(calculateSettledUsage(snapshot, clock), 2);
  });

  it('ignores running session', () => {
    const snapshot = {
      sessions: [
        {
          status: 'running',
          settlement_status: null,
          started_at: '2026-06-28T09:00:00.000Z',
          ended_at: null,
        },
      ],
    };
    assert.equal(calculateSettledUsage(snapshot, clock), 0);
  });
});

describe('calculateCurrentSessionElapsed', () => {
  it('returns 0 when no running session', () => {
    assert.equal(
      calculateCurrentSessionElapsed({ sessions: [], providerRunningVerified: true }, clock),
      0,
    );
  });

  it('returns elapsed for one verified running session (full precision)', () => {
    const snapshot = {
      providerRunningVerified: true,
      sessions: [
        {
          status: 'running',
          started_at: '2026-06-28T08:30:00.000Z',
        },
      ],
    };
    assert.equal(calculateCurrentSessionElapsed(snapshot, clock), 1.5);
  });

  it('returns 0 when provider not verified', () => {
    const snapshot = {
      providerRunningVerified: false,
      sessions: [
        {
          status: 'running',
          started_at: '2026-06-28T08:00:00.000Z',
        },
      ],
    };
    assert.equal(calculateCurrentSessionElapsed(snapshot, clock), 0);
  });

  it('throws RemainingInvariantError when multiple running sessions', () => {
    const snapshot = {
      providerRunningVerified: true,
      sessions: [
        { status: 'running', started_at: '2026-06-28T09:00:00.000Z' },
        { status: 'running', started_at: '2026-06-28T09:30:00.000Z' },
      ],
    };
    assert.throws(
      () => calculateCurrentSessionElapsed(snapshot, clock),
      (err) => {
        assert.ok(err instanceof RemainingInvariantError);
        assert.equal(err.code, REMAINING_ERROR_MULTIPLE_RUNNING_SESSIONS);
        assert.equal(err.details.runningSessionCount, 2);
        return true;
      },
    );
  });
});

describe('calculateRemaining', () => {
  it('user with no session — full entitlement', () => {
    const result = calculateRemaining(
      {
        entitlementPlans: [{ status: 'active', plan_type: 'combo', hours_remaining: 10 }],
        walletBalance: 0,
        sessions: [],
        providerRunningVerified: false,
      },
      clock,
    );
    assert.equal(result.state, REMAINING_STATE_OK);
    assert.equal(result.remainingHours, 10);
    assert.equal(result.settledSessionUsageHours, 0);
    assert.equal(result.currentSessionElapsedHours, 0);
  });

  it('user with running session and settled history', () => {
    const result = calculateRemaining(
      {
        entitlementPlans: [{ status: 'active', plan_type: 'combo', hours_remaining: 10 }],
        walletBalance: 0,
        providerRunningVerified: true,
        sessions: [
          {
            status: 'closed',
            settlement_status: 'settled',
            started_at: '2026-06-28T06:00:00.000Z',
            ended_at: '2026-06-28T08:00:00.000Z',
          },
          {
            status: 'running',
            started_at: '2026-06-28T08:30:00.000Z',
          },
        ],
      },
      clock,
    );
    assert.equal(result.state, REMAINING_STATE_OK);
    assert.equal(result.totalEntitlementHours, 10);
    assert.equal(result.settledSessionUsageHours, 2);
    assert.equal(result.currentSessionElapsedHours, 1.5);
    assert.equal(result.remainingHours, 6.5);
  });

  it('multiple settled sessions', () => {
    const result = calculateRemaining(
      {
        entitlementPlans: [{ status: 'active', plan_type: 'combo', hours_remaining: 20 }],
        sessions: [
          {
            status: 'closed',
            settlement_status: 'settled',
            started_at: '2026-06-27T10:00:00.000Z',
            ended_at: '2026-06-27T12:00:00.000Z',
          },
          {
            status: 'closed',
            settlement_status: 'settled',
            started_at: '2026-06-28T06:00:00.000Z',
            ended_at: '2026-06-28T07:00:00.000Z',
          },
        ],
      },
      clock,
    );
    assert.equal(result.state, REMAINING_STATE_OK);
    assert.equal(result.settledSessionUsageHours, 3);
    assert.equal(result.remainingHours, 17);
  });

  it('clamps negative remaining to 0 (full precision)', () => {
    const result = calculateRemaining(
      {
        entitlementPlans: [{ status: 'active', plan_type: 'combo', hours_remaining: 1 }],
        providerRunningVerified: true,
        sessions: [
          {
            status: 'closed',
            settlement_status: 'settled',
            started_at: '2026-06-28T06:00:00.000Z',
            ended_at: '2026-06-28T08:00:00.000Z',
          },
          {
            status: 'running',
            started_at: '2026-06-28T09:00:00.000Z',
          },
        ],
      },
      clock,
    );
    assert.equal(result.state, REMAINING_STATE_OK);
    assert.equal(result.remainingHours, 0);
  });

  it('ignores corrupt epoch started_at for current session elapsed (SCB M2 guard)', () => {
    const result = calculateRemaining(
      {
        entitlementPlans: [{ status: 'active', plan_type: 'combo', hours_remaining: 20 }],
        providerRunningVerified: true,
        sessions: [{ status: 'running', started_at: '1970-01-01T00:00:00.000Z' }],
      },
      clock,
    );
    assert.equal(result.state, REMAINING_STATE_OK);
    assert.equal(result.currentSessionElapsedHours, 0);
    assert.equal(result.remainingHours, 20);
  });

  it('uses verified_running_at when started_at is corrupt', () => {
    const result = calculateRemaining(
      {
        entitlementPlans: [{ status: 'active', plan_type: 'combo', hours_remaining: 20 }],
        providerRunningVerified: true,
        sessions: [
          {
            status: 'running',
            started_at: '1970-01-01T00:00:00.000Z',
            verified_running_at: '2026-06-28T08:00:00.000Z',
          },
        ],
      },
      clock,
    );
    assert.equal(result.state, REMAINING_STATE_OK);
    assert.equal(result.currentSessionElapsedHours, 2);
    assert.equal(result.remainingHours, 18);
  });

  it('remaining exactly 0', () => {
    const result = calculateRemaining(
      {
        entitlementPlans: [{ status: 'active', plan_type: 'combo', hours_remaining: 2 }],
        sessions: [
          {
            status: 'closed',
            settlement_status: 'settled',
            started_at: '2026-06-28T08:00:00.000Z',
            ended_at: '2026-06-28T10:00:00.000Z',
          },
        ],
      },
      clock,
    );
    assert.equal(result.state, REMAINING_STATE_OK);
    assert.equal(result.remainingHours, 0);
  });

  it('returns INVALID_STATE when multiple running sessions', () => {
    const result = calculateRemaining(
      {
        entitlementPlans: [{ status: 'active', plan_type: 'combo', hours_remaining: 10 }],
        providerRunningVerified: true,
        sessions: [
          { status: 'running', started_at: '2026-06-28T09:00:00.000Z' },
          { status: 'running', started_at: '2026-06-28T09:30:00.000Z' },
        ],
      },
      clock,
    );
    assert.equal(result.state, REMAINING_INVALID_STATE);
    assert.equal(result.code, REMAINING_ERROR_MULTIPLE_RUNNING_SESSIONS);
    assert.equal(result.runningSessionCount, 2);
  });

  it('is deterministic for same inputs', () => {
    const snapshot = {
      entitlementPlans: [{ status: 'active', plan_type: 'combo', hours_remaining: 5 }],
      sessions: [],
    };
    const a = calculateRemaining(snapshot, clock);
    const b = calculateRemaining(snapshot, clock);
    assert.deepEqual(a, b);
  });

  it('machine-scoped Remaining ignores other packages and does not subtract settled history', () => {
    const result = calculateRemaining(
      {
        machine: { gpu_line: 'rtx3090', billing_inventory_id: 1 },
        entitlementPlans: [
          { id: 1, status: 'active', plan_type: 'combo', plan_name: 'starter', hours_remaining: 1 },
          { id: 2, status: 'active', plan_type: 'combo', plan_name: 'pro', hours_remaining: 40 },
        ],
        walletBalance: 0,
        providerRunningVerified: true,
        sessions: [
          {
            status: 'closed',
            settlement_status: 'settled',
            started_at: '2026-06-28T06:00:00.000Z',
            ended_at: '2026-06-28T09:00:00.000Z',
          },
          {
            status: 'running',
            started_at: '2026-06-28T09:30:00.000Z',
          },
        ],
      },
      clock,
    );
    assert.equal(result.state, REMAINING_STATE_OK);
    // Starter inventory already post-settlement; do not subtract closed sessions again.
    assert.equal(result.totalEntitlementHours, 1);
    assert.equal(result.settledSessionUsageHours, 0);
    assert.equal(result.currentSessionElapsedHours, 0.5);
    assert.equal(result.remainingHours, 0.5);
  });

  it('machine-scoped Remaining hits 0 when active package empties even if other packages have hours', () => {
    const result = calculateRemaining(
      {
        machine: { gpu_line: 'rtx3090' },
        entitlementPlans: [
          { status: 'active', plan_type: 'combo', plan_name: 'starter', hours_remaining: 0.25 },
          { status: 'active', plan_type: 'combo', plan_name: 'pro', hours_remaining: 100 },
        ],
        walletBalance: 0,
        providerRunningVerified: true,
        sessions: [
          {
            status: 'running',
            started_at: '2026-06-28T09:45:00.000Z',
          },
        ],
      },
      clock,
    );
    assert.equal(result.state, REMAINING_STATE_OK);
    assert.equal(result.remainingHours, 0);
  });

  it('packageRemainingHours includes prepaid giờ lẻ but excludes wallet', () => {
    const result = calculateRemaining(
      {
        machine: { gpu_line: 'rtx3090' },
        entitlementPlans: [
          { status: 'active', plan_type: 'gift', plan_name: 'starter', hours_remaining: 10 },
          { status: 'active', plan_type: 'combo', plan_name: 'starter', hours_remaining: 680 },
          {
            status: 'active',
            plan_type: 'hourly',
            plan_name: 'starter',
            hours_remaining: 10,
            price_per_hour: 9900,
          },
        ],
        walletBalance: 12_380_000,
        providerRunningVerified: true,
        sessions: [
          {
            status: 'running',
            started_at: '2026-06-28T09:00:00.000Z',
          },
        ],
      },
      clock,
    );
    assert.equal(result.state, REMAINING_STATE_OK);
    assert.equal(result.packagePoolHours, 700);
    assert.equal(result.packageRemainingHours, 699);
    // Full remaining still includes ví for auto-stop / out-of-credit.
    assert.ok(result.remainingHours > 1900);
  });
});

describe('isOutOfCredit', () => {
  it('true when remaining is 0', () => {
    assert.equal(
      isOutOfCredit({
        state: REMAINING_STATE_OK,
        remainingHours: 0,
        primaryPlanType: 'combo',
        walletBalance: 1000,
      }),
      true,
    );
  });

  it('true for hourly when wallet empty', () => {
    assert.equal(
      isOutOfCredit({
        state: REMAINING_STATE_OK,
        remainingHours: 1,
        primaryPlanType: 'hourly',
        walletBalance: 0,
      }),
      true,
    );
  });

  it('false for combo with remaining', () => {
    assert.equal(
      isOutOfCredit({
        state: REMAINING_STATE_OK,
        remainingHours: 2,
        primaryPlanType: 'combo',
        walletBalance: 0,
      }),
      false,
    );
  });
});

describe('calculateSessionBillableSeconds', () => {
  it('uses timestamps only', () => {
    assert.equal(
      calculateSessionBillableSeconds('2026-06-28T08:00:00.000Z', '2026-06-28T09:30:00.000Z'),
      5400,
    );
  });
});

describe('clampRemainingHours', () => {
  it('clamps negative values without rounding', () => {
    assert.equal(clampRemainingHours(-0.123456789), 0);
  });

  it('preserves full precision for positive values', () => {
    assert.equal(clampRemainingHours(3.3333333333), 3.3333333333);
  });
});
