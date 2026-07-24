import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { REMAINING_STATE_OK } from './remaining-time.js';
import { calculateRemaining } from './remaining-time.js';
import { resolveScbRemainingHours } from './billing-projection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, '../..');

function readSrc(relativePath) {
  return readFileSync(path.join(srcRoot, relativePath), 'utf8');
}

function isWithinAutoRenewThreshold(hoursRemaining, threshold) {
  return hoursRemaining !== null && hoursRemaining <= threshold;
}

describe('resolveScbRemainingHours (M10)', () => {
  it('returns remainingHours for OK state', () => {
    assert.equal(
      resolveScbRemainingHours({
        state: REMAINING_STATE_OK,
        remainingHours: 7.5,
        totalEntitlementHours: 12,
        settledSessionUsageHours: 2,
        currentSessionElapsedHours: 2.5,
        primaryPlanType: 'combo',
      }),
      7.5,
    );
  });

  it('returns null for invalid state', () => {
    assert.equal(resolveScbRemainingHours(null), null);
    assert.equal(
      resolveScbRemainingHours({
        state: 'INVALID',
        code: 'MULTIPLE_RUNNING_SESSIONS',
        message: 'invalid',
        runningSessionCount: 2,
      }),
      null,
    );
  });
});

describe('auto-renew threshold (M10 T1)', () => {
  it('12h entitlement, 3h running elapsed, threshold 10 → withinThreshold true', () => {
    const now = new Date('2026-07-03T12:00:00.000Z');
    const remaining = calculateRemaining(
      {
        entitlementPlans: [
          {
            plan_type: 'combo',
            plan_name: 'pro',
            hours_remaining: 12,
            status: 'active',
          },
        ],
        walletBalance: 0,
        sessions: [
          {
            status: 'running',
            started_at: new Date(now.getTime() - 3 * 3600 * 1000).toISOString(),
            ended_at: null,
            settlement_status: null,
          },
        ],
        providerRunningVerified: true,
      },
      { nowMs: () => now.getTime() },
    );

    assert.equal(remaining.state, REMAINING_STATE_OK);
    assert.equal(remaining.remainingHours, 9);

    const hoursRemaining = resolveScbRemainingHours(remaining);
    assert.equal(hoursRemaining, 9);
    assert.equal(isWithinAutoRenewThreshold(hoursRemaining, 10), true);
  });

  it('no active session → remaining = post-settlement entitlement (not minus settled again)', () => {
    const remaining = calculateRemaining({
      entitlementPlans: [
        {
          plan_type: 'combo',
          plan_name: 'pro',
          hours_remaining: 10,
          status: 'active',
        },
      ],
      walletBalance: 0,
      sessions: [
        {
          status: 'closed',
          started_at: '2026-07-01T10:00:00.000Z',
          ended_at: '2026-07-01T12:00:00.000Z',
          settlement_status: 'settled',
        },
      ],
      providerRunningVerified: false,
    });

    assert.equal(remaining.state, REMAINING_STATE_OK);
    assert.equal(remaining.settledSessionUsageHours, 2);
    assert.equal(remaining.remainingHours, 10);
  });

  it('threshold boundary at 10h default', () => {
    assert.equal(isWithinAutoRenewThreshold(10, 10), true);
    assert.equal(isWithinAutoRenewThreshold(10.01, 10), false);
  });
});

describe('M10 legacy remaining removal (grep)', () => {
  const consumerFiles = [
    'lib/auto-renew.js',
    'lib/plan-renew-request.js',
    'lib/user-plan-inventory.js',
    'lib/admin-customers.js',
  ];

  const legacyPattern = /hours_total\s*[^\n]*-\s*[^\n]*hours_used/;

  for (const file of consumerFiles) {
    it(`${file} does not compute hours_total - hours_used for remaining`, () => {
      const source = readSrc(file);
      if (file === 'lib/user-plan-inventory.js') {
        const processSection = source.slice(source.indexOf('export async function processPlanRenew'));
        assert.ok(!legacyPattern.test(processSection));
        return;
      }
      if (file === 'lib/plan-renew-request.js') {
        const loadSection = source.slice(source.indexOf('async function loadRenewContext'));
        assert.ok(!legacyPattern.test(loadSection));
        return;
      }
      assert.ok(!legacyPattern.test(source), `${file} still has legacy remaining formula`);
    });
  }

  it('auto-renew.js uses loadScbRemainingForUser', () => {
    const source = readSrc('lib/auto-renew.js');
    assert.ok(source.includes('loadScbRemainingForUser'));
    assert.ok(!source.includes('getHoursRemaining(subscription)'));
  });

  it('admin-customers.js uses loadScbRemainingBatch', () => {
    const source = readSrc('lib/admin-customers.js');
    assert.ok(source.includes('loadScbRemainingBatch'));
    assert.ok(source.includes('REMAINING_STATE_OK'));
  });

  it('remaining-consumer.js delegates to readRemainingForUser', () => {
    const source = readSrc('lib/gpu/remaining-consumer.js');
    assert.ok(source.includes('readRemainingForUser'));
    assert.ok(source.includes('resolveScbRemainingHours'));
  });
});

describe('M10 API routes use M2-backed auto-renew', () => {
  it('settings API uses evaluateAutoRenew', () => {
    const source = readSrc('pages/api/user/settings.js');
    assert.ok(source.includes('evaluateAutoRenew'));
  });
});
