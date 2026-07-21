import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getBackupIntervalsForPlan,
  mergeBackupIntervalsByPlan,
  isGlobalStarterAutoBackupActive,
  normalizeAutoBackupOverride,
  planDefaultAutoBackup,
  resolveAutoBackupEnabled,
} from './backup-auto-policy.js';

describe('planDefaultAutoBackup', () => {
  it('starter / pro / studio all on', () => {
    assert.equal(planDefaultAutoBackup('starter'), true);
    assert.equal(planDefaultAutoBackup('Starter'), true);
    assert.equal(planDefaultAutoBackup('pro'), true);
    assert.equal(planDefaultAutoBackup('studio'), true);
    assert.equal(planDefaultAutoBackup(null), true);
  });
});

describe('getBackupIntervalsForPlan', () => {
  it('returns tiered outputs / workflows seconds', () => {
    assert.deepEqual(getBackupIntervalsForPlan('starter'), {
      outputsSec: 10 * 60,
      workflowsSec: 20 * 60,
    });
    assert.deepEqual(getBackupIntervalsForPlan('pro'), {
      outputsSec: 3 * 60,
      workflowsSec: 10 * 60,
    });
    assert.deepEqual(getBackupIntervalsForPlan('studio'), {
      outputsSec: 60,
      workflowsSec: 5 * 60,
    });
    assert.deepEqual(getBackupIntervalsForPlan(null), getBackupIntervalsForPlan('starter'));
  });

  it('applies admin override map', () => {
    const overridden = mergeBackupIntervalsByPlan({
      starter: { outputsSec: 120, workflowsSec: 240 },
    });
    assert.deepEqual(getBackupIntervalsForPlan('starter', overridden), {
      outputsSec: 120,
      workflowsSec: 240,
    });
    assert.deepEqual(getBackupIntervalsForPlan('pro', overridden), {
      outputsSec: 3 * 60,
      workflowsSec: 10 * 60,
    });
  });

  it('clamps too-small intervals to 30s', () => {
    const clamped = mergeBackupIntervalsByPlan({
      studio: { outputsSec: 5, workflowsSec: 10 },
    });
    assert.equal(clamped.studio.outputsSec, 30);
    assert.equal(clamped.studio.workflowsSec, 30);
  });
});

describe('normalizeAutoBackupOverride', () => {
  it('accepts force_on / force_off / null', () => {
    assert.equal(normalizeAutoBackupOverride('force_on'), 'force_on');
    assert.equal(normalizeAutoBackupOverride('FORCE_OFF'), 'force_off');
    assert.equal(normalizeAutoBackupOverride(null), null);
    assert.equal(normalizeAutoBackupOverride('default'), null);
    assert.equal(normalizeAutoBackupOverride('garbage'), null);
  });
});

describe('isGlobalStarterAutoBackupActive', () => {
  const now = new Date('2026-07-12T12:00:00Z').getTime();

  it('false when flag off', () => {
    assert.equal(
      isGlobalStarterAutoBackupActive({ starterAutoBackup: false }, now),
      false,
    );
  });

  it('true when flag on and no window', () => {
    assert.equal(
      isGlobalStarterAutoBackupActive({ starterAutoBackup: true }, now),
      true,
    );
  });

  it('respects starts_at / ends_at window', () => {
    assert.equal(
      isGlobalStarterAutoBackupActive(
        {
          starterAutoBackup: true,
          startsAt: '2026-07-01T00:00:00Z',
          endsAt: '2026-08-01T00:00:00Z',
        },
        now,
      ),
      true,
    );
    assert.equal(
      isGlobalStarterAutoBackupActive(
        {
          starterAutoBackup: true,
          startsAt: '2026-08-01T00:00:00Z',
          endsAt: '2026-09-01T00:00:00Z',
        },
        now,
      ),
      false,
    );
    assert.equal(
      isGlobalStarterAutoBackupActive(
        {
          starterAutoBackup: true,
          startsAt: '2026-06-01T00:00:00Z',
          endsAt: '2026-07-01T00:00:00Z',
        },
        now,
      ),
      false,
    );
  });
});

describe('resolveAutoBackupEnabled', () => {
  const promo = {
    starterAutoBackup: true,
    startsAt: '2026-07-01T00:00:00Z',
    endsAt: '2026-08-01T00:00:00Z',
  };
  const now = '2026-07-12T12:00:00Z';

  it('plan defaults on for all tiers without override', () => {
    assert.deepEqual(resolveAutoBackupEnabled({ planKey: 'starter' }), {
      enabled: true,
      planKey: 'starter',
      override: null,
      source: 'plan_default',
    });
    assert.equal(resolveAutoBackupEnabled({ planKey: 'pro' }).enabled, true);
    assert.equal(resolveAutoBackupEnabled({ planKey: 'studio' }).source, 'plan_default');
  });

  it('global starter promo no longer required for starter enable', () => {
    const withPromo = resolveAutoBackupEnabled({
      planKey: 'starter',
      globalStarterPolicy: promo,
      now,
    });
    const without = resolveAutoBackupEnabled({ planKey: 'starter' });
    assert.equal(withPromo.enabled, true);
    assert.equal(without.enabled, true);
    assert.equal(withPromo.source, 'plan_default');
  });

  it('user force_on still works', () => {
    const r = resolveAutoBackupEnabled({
      planKey: 'starter',
      userOverride: 'force_on',
    });
    assert.equal(r.enabled, true);
    assert.equal(r.source, 'force_on');
  });

  it('user force_off beats plan default and global promo', () => {
    const r = resolveAutoBackupEnabled({
      planKey: 'pro',
      userOverride: 'force_off',
      globalStarterPolicy: promo,
      now,
    });
    assert.equal(r.enabled, false);
    assert.equal(r.source, 'force_off');
  });

  it('user force_off beats starter plan default', () => {
    const r = resolveAutoBackupEnabled({
      planKey: 'starter',
      userOverride: 'force_off',
      globalStarterPolicy: promo,
      now,
    });
    assert.equal(r.enabled, false);
    assert.equal(r.source, 'force_off');
  });
});
