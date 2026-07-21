import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REMAINING_STATE_OK } from './remaining-time.js';
import {
  AUTO_STOP_DECISION,
  CREDIT_WARN_MINUTES,
  decideAutoStopAction,
  shouldStopForOutOfCredit,
  shouldStopForIdle,
  shouldWarnForIdle,
  shouldWarnForLowCredit,
} from './auto-stop-core.js';

const okRemaining = (remainingHours, primaryPlanType = 'combo') => ({
  state: REMAINING_STATE_OK,
  remainingHours,
  totalEntitlementHours: 5,
  settledSessionUsageHours: 0,
  currentSessionElapsedHours: 0,
  primaryPlanType,
});

describe('shouldStopForOutOfCredit', () => {
  it('T1 — triggers when remaining ≤ 0', () => {
    assert.equal(shouldStopForOutOfCredit(okRemaining(0), 1000, true), true);
    assert.equal(shouldStopForOutOfCredit(okRemaining(-1), 1000, true), true);
  });

  it('T1 — does not trigger when remaining > 0', () => {
    assert.equal(shouldStopForOutOfCredit(okRemaining(0.5), 1000, true), false);
  });

  it('hourly with empty wallet triggers', () => {
    assert.equal(shouldStopForOutOfCredit(okRemaining(1, 'hourly'), 0, true), true);
  });

  it('skips when machine has no billing anchor', () => {
    assert.equal(shouldStopForOutOfCredit(okRemaining(0), 0, false), false);
  });
});

describe('idle decisions', () => {
  it('T2 — idle ≥ 60 triggers stop', () => {
    assert.equal(shouldStopForIdle(60), true);
    assert.equal(shouldStopForIdle(59), false);
  });

  it('T3 — idle 55 warns only', () => {
    assert.equal(shouldWarnForIdle(55, false), true);
    assert.equal(shouldWarnForIdle(55, true), false);
    assert.equal(shouldStopForIdle(55), false);
  });
});

describe('credit warning', () => {
  it('warns at ≤ 30 minutes remaining', () => {
    assert.equal(shouldWarnForLowCredit(okRemaining(0.5), false, true), true);
    assert.equal(shouldWarnForLowCredit(okRemaining(CREDIT_WARN_MINUTES / 60), false, true), true);
    assert.equal(shouldWarnForLowCredit(okRemaining(0.51), false, true), false);
  });

  it('does not warn twice or when already out of credit', () => {
    assert.equal(shouldWarnForLowCredit(okRemaining(0.4), true, true), false);
    assert.equal(shouldWarnForLowCredit(okRemaining(0), false, true), false);
  });
});

describe('decideAutoStopAction', () => {
  const base = {
    machineStatus: 'running',
    machineHasBilling: true,
    remaining: okRemaining(2),
    walletBalance: 1000,
    hasEndpoint: true,
    queueReachable: true,
    hasActiveJobs: false,
    idleMinutes: 10,
    idleWarningSent: false,
    creditWarningSent: false,
  };

  it('T1 — remaining > 0 does not destroy for credit', () => {
    const d = decideAutoStopAction(base);
    assert.notEqual(d.reason, 'out_of_credit');
    assert.notEqual(d.decision, AUTO_STOP_DECISION.DESTROY);
  });

  it('T1 — remaining = 0 destroys for credit before idle', () => {
    const d = decideAutoStopAction({ ...base, remaining: okRemaining(0) });
    assert.equal(d.decision, AUTO_STOP_DECISION.DESTROY);
    assert.equal(d.reason, 'out_of_credit');
  });

  it('warns for low credit before idle checks', () => {
    const d = decideAutoStopAction({ ...base, remaining: okRemaining(0.4) });
    assert.equal(d.decision, AUTO_STOP_DECISION.WARN);
    assert.equal(d.reason, 'low_credit');
    assert.equal(d.remainingMinutes, 24);
  });

  it('T2 — idle timeout destroys when credit ok', () => {
    const d = decideAutoStopAction({ ...base, idleMinutes: 60 });
    assert.equal(d.decision, AUTO_STOP_DECISION.DESTROY);
    assert.equal(d.reason, 'idle_timeout');
  });

  it('T5 — queue unreachable returns error without destroy', () => {
    const d = decideAutoStopAction({ ...base, queueReachable: false });
    assert.equal(d.decision, AUTO_STOP_DECISION.ERROR);
    assert.equal(d.reason, 'queue_unreachable');
  });

  it('active jobs skip idle destroy', () => {
    const d = decideAutoStopAction({ ...base, hasActiveJobs: true, idleMinutes: 90 });
    assert.equal(d.decision, AUTO_STOP_DECISION.ACTIVE);
  });
});
