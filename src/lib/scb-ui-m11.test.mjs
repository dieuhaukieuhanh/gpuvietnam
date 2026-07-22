import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeDisplayRemainingHours,
  computeSessionElapsedSeconds,
  mergeBillingSessionViewOnPoll,
  mergeMachineSessionViewOnPoll,
  resolveRemainingHoursAnchor,
  resolveSessionElapsedAnchor,
} from './scb-ui-view-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const componentsRoot = path.join(__dirname, '../components');

function readComponent(relativePath) {
  return readFileSync(path.join(componentsRoot, relativePath), 'utf8');
}

describe('scb-ui-view-model (presentation)', () => {
  it('session elapsed anchor resyncs from API duration on poll', () => {
    const syncMs = Date.parse('2026-07-03T10:05:00.000Z');
    const anchor = resolveSessionElapsedAnchor({ sessionDurationSeconds: 300 }, syncMs);
    assert.equal(anchor.mode, 'duration');
    assert.equal(anchor.baseSeconds, 300);
    assert.equal(
      computeSessionElapsedSeconds(anchor, syncMs + 15_000),
      315,
    );
  });

  it('session elapsed uses billingStartedAt when duration is zero', () => {
    const startedMs = Date.parse('2026-07-03T10:00:00.000Z');
    const anchor = resolveSessionElapsedAnchor({
      sessionDurationSeconds: 0,
      billingStartedAt: '2026-07-03T10:00:00.000Z',
    });
    assert.equal(anchor.mode, 'startedAt');
    assert.equal(computeSessionElapsedSeconds(anchor, startedMs + 45_000), 45);
  });

  it('session elapsed ignores corrupt epoch billingStartedAt', () => {
    const anchor = resolveSessionElapsedAnchor({
      sessionDurationSeconds: 0,
      billingStartedAt: '1970-01-01T00:00:00.000Z',
    });
    assert.equal(anchor.mode, 'duration');
    assert.equal(anchor.baseSeconds, 0);
    assert.equal(computeSessionElapsedSeconds(anchor), 0);
  });

  it('session elapsed ignores absurd sessionDurationSeconds from API', () => {
    const anchor = resolveSessionElapsedAnchor({
      sessionDurationSeconds: 1_783_213_200,
      billingStartedAt: null,
    });
    assert.equal(anchor.mode, 'duration');
    assert.equal(anchor.baseSeconds, 0);
    assert.equal(computeSessionElapsedSeconds(anchor), 0);
  });

  it('session elapsed uses verifiedRunningAt when billingStartedAt is missing', () => {
    const startedMs = Date.parse('2026-07-03T10:00:00.000Z');
    const anchor = resolveSessionElapsedAnchor({
      sessionDurationSeconds: 0,
      billingStartedAt: null,
      verifiedRunningAt: '2026-07-03T10:00:00.000Z',
    });
    assert.equal(anchor.mode, 'startedAt');
    assert.equal(computeSessionElapsedSeconds(anchor, startedMs + 120_000), 120);
  });

  it('remaining hours anchor requires API pair remainingHours + sessionDurationSeconds', () => {
    assert.equal(resolveRemainingHoursAnchor(7.5, 300)?.remainingHours, 7.5);
    assert.equal(resolveRemainingHoursAnchor(7.5, 300)?.sessionDurationSeconds, 300);
    assert.equal(resolveRemainingHoursAnchor(null, 300), null);
    assert.equal(resolveRemainingHoursAnchor(7.5, 0), null);
  });

  it('display remaining hours interpolates from poll anchor and elapsed clock', () => {
    const anchor = resolveRemainingHoursAnchor(10, 3600);
    assert.equal(computeDisplayRemainingHours(anchor, 3600), 10);
    assert.equal(computeDisplayRemainingHours(anchor, 3660), 10 - 60 / 3600);
    assert.equal(computeDisplayRemainingHours(anchor, 7200), 9);
    assert.equal(computeDisplayRemainingHours(anchor, 3600 + 10 * 3600), 0);
  });

  it('display remaining hours returns null without anchor', () => {
    assert.equal(computeDisplayRemainingHours(null, 100), null);
  });

  it('mergeBillingSessionViewOnPoll rejects stale remaining regression after session end', () => {
    const prev = {
      billingStarted: true,
      sessionDurationSeconds: 1800,
      phase: 'running',
      remainingHours: 19.7,
      planCardRemainingHours: 19.7,
    };
    const stale = {
      billingStarted: false,
      sessionDurationSeconds: 0,
      phase: 'idle',
      remainingHours: 20.1,
      planCardRemainingHours: 20.1,
    };
    const merged = mergeBillingSessionViewOnPoll(prev, stale);
    assert.equal(merged.planCardRemainingHours, 19.7);
    assert.equal(merged.remainingHours, 19.7);

    const settled = { ...stale, remainingHours: 19.65, planCardRemainingHours: 19.65 };
    const accepted = mergeBillingSessionViewOnPoll(prev, settled);
    assert.equal(accepted.planCardRemainingHours, 19.65);
  });

  it('mergeBillingSessionViewOnPoll rejects stale increase during stopping phase', () => {
    const prev = {
      billingStarted: true,
      phase: 'running',
      remainingHours: 19.7,
      planCardRemainingHours: 19.7,
    };
    const staleStopping = {
      billingStarted: true,
      phase: 'stopping',
      remainingHours: 20.1,
      planCardRemainingHours: 20.1,
    };
    const merged = mergeBillingSessionViewOnPoll(prev, staleStopping);
    assert.equal(merged.planCardRemainingHours, 19.7);
  });

  it('mergeBillingSessionViewOnPoll rejects stale increase after billable session', () => {
    const prev = {
      billingStarted: true,
      sessionDurationSeconds: 3600,
      phase: 'idle',
      remainingHours: 19.7,
      planCardRemainingHours: 19.7,
    };
    const stale = {
      billingStarted: false,
      sessionDurationSeconds: 0,
      phase: 'idle',
      remainingHours: 20.1,
      planCardRemainingHours: 20.1,
    };
    const merged = mergeBillingSessionViewOnPoll(prev, stale);
    assert.equal(merged.planCardRemainingHours, 19.7);
  });

  it('mergeMachineSessionViewOnPoll keeps opening during boot guard', () => {
    const prev = {
      phase: 'opening',
      serverStatus: 'provisioning',
      clientOptimistic: true,
      actions: { canStart: false, canCancel: true },
    };
    const staleIdle = {
      phase: 'idle',
      serverStatus: 'offline',
      actions: { canStart: true, canCancel: false },
    };
    const merged = mergeMachineSessionViewOnPoll(prev, staleIdle, {
      openingGuardUntilMs: Date.now() + 30_000,
    });
    assert.equal(merged.phase, 'opening');

    const acceptedIdle = mergeMachineSessionViewOnPoll(
      { ...prev, clientOptimistic: false },
      staleIdle,
      { openingGuardUntilMs: Date.now() - 1 },
    );
    assert.equal(acceptedIdle.phase, 'idle');
  });

  it('mergeMachineSessionViewOnPoll blocks stopping to opening flicker', () => {
    const prev = { phase: 'stopping', serverStatus: 'stopping' };
    const staleOpening = { phase: 'opening', serverStatus: 'provisioning' };
    const merged = mergeMachineSessionViewOnPoll(prev, staleOpening);
    assert.equal(merged.phase, 'stopping');
  });
});

describe('M11 frontend legacy removal (grep)', () => {
  const files = [
    'dashboard/DashboardOverview.tsx',
    'dashboard/DashboardCurrentSessionCard.tsx',
    'pages/DashboardSettingsPage.tsx',
    'admin/AdminCustomersPanel.tsx',
  ];

  const forbidden = [
    'BILLING_ANCHOR_CACHE_KEY',
    'SESSION_START_HOURS_CACHE_KEY',
    'resolveLiveEffectiveHours',
    'effectiveHoursRemaining',
    'hours_total - hours_used',
    'hours_total-hours_used',
    'billed_seconds',
    'duration_seconds',
    'resolveTrafficReadyServerPhase',
    'mapMachineStatusApiToScbView',
    'pickPlanCardRemainingHours',
  ];

  for (const file of files) {
    it(`${file} avoids legacy client billing math`, () => {
      const source = readComponent(file);
      for (const token of forbidden) {
        assert.ok(!source.includes(token), `${file} must not reference ${token}`);
      }
    });
  }

  it('DashboardOverview uses server views and smooth display hooks', () => {
    const source = readComponent('dashboard/DashboardOverview.tsx');
    assert.ok(source.includes('machineSessionView'));
    assert.ok(source.includes('billingView'));
    assert.ok(source.includes('useMachineInfraMetrics'));
    assert.ok(source.includes('shouldPollInfra'));
    assert.ok(source.includes('syncDashboardAndInfra'));
    assert.ok(source.includes('useSessionElapsedSeconds'));
    assert.ok(source.includes('useInterpolatedRemainingHours'));
    assert.ok(source.includes('billingStarted'));
    assert.ok(source.includes('serverCardPhase'));
    assert.ok(!source.includes('gpu_dashboard_machine_status_v1'));
    assert.ok(!source.includes('localStorage'));
    assert.ok(!source.includes('sessionStorage'));
    assert.ok(!source.includes('fetchMachineMetrics'));
    assert.ok(!source.includes('autoDestroyTriggeredRef'));
  });

  it('useMachineInfraMetrics does not consume billingView from status poll', () => {
    const source = readFileSync(
      path.join(__dirname, '../hooks/useMachineInfraMetrics.ts'),
      'utf8',
    );
    assert.ok(source.includes('/api/machines/status'));
    assert.ok(!source.includes('billingView'));
    assert.ok(!source.includes('sessionDurationSeconds'));
    assert.ok(!source.includes('remainingHours'));
  });

  it('machines/status projection omits billing session view from JSON response', () => {
    const source = readFileSync(
      path.join(__dirname, 'machines-status-projection.js'),
      'utf8',
    );
    assert.ok(!source.includes('buildBillingSessionView'));
    assert.ok(!source.includes('loadActiveSessionRow'));
  });

  it('DashboardCurrentSessionCard uses remainingHours prop', () => {
    const source = readComponent('dashboard/DashboardCurrentSessionCard.tsx');
    assert.ok(source.includes('remainingHours'));
    assert.ok(source.includes('timerMode'));
    assert.ok(source.includes('billingStarted'));
    assert.ok(!source.includes('DashboardSessionBootTimeline'));
    assert.ok(!source.includes('liveEffectiveHours'));
    assert.ok(source.includes("phase === 'loading'"));
  });

  it('DashboardOverview wires session UX helpers across three cards', () => {
    const source = readComponent('dashboard/DashboardOverview.tsx');
    assert.ok(source.includes('resolveTimerDisplayMode'));
    assert.ok(source.includes('Đang mở phiên làm việc'));
    assert.ok(source.includes('dashboard-opening-progress'));
    assert.ok(!source.includes('<DashboardSessionBootTimeline'));
    assert.ok(source.includes('formatDisplayHours'));
    assert.ok(source.includes('planCardFromSubscription'));
    assert.ok(source.includes('showLiveTimer'));
  });

  it('DashboardOverview stop flow runs client post-check until idle', () => {
    const source = readComponent('dashboard/DashboardOverview.tsx');
    assert.ok(source.includes('evaluateStopPostCheckSnapshot'));
    assert.ok(source.includes('STOP_POST_CHECK'));
    assert.ok(source.includes('stopPostCheckActive'));
    assert.ok(source.includes('formatStopPostCheckSuccessToast'));
    assert.ok(source.includes('BACKUP_CHOICE_REQUIRED'));
    assert.ok(source.includes('forceStop'));
    assert.ok(source.includes('waitForBackup'));
  });

  it('openBillableSession does not rewrite billing_started_at on already-started path', () => {
    const source = readFileSync(
      path.join(__dirname, 'gpu/session-start.js'),
      'utf8',
    );
    assert.ok(source.includes('alreadyStarted: true'));
    assert.ok(source.includes('startedAt: machine.billing_started_at'));
    assert.ok(source.includes('reused: true'));
    assert.ok(source.includes('traffic_not_ready'));
  });
});
