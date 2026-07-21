import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { REMAINING_STATE_OK } from './remaining-time.js';
import {
  mapDestroyApiResponse,
  mapRemainingStatusFields,
  mapSessionStatusFields,
} from './api-scb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.join(__dirname, '../../pages/api');

function readApiSrc(relativePath) {
  return readFileSync(path.join(apiRoot, relativePath), 'utf8');
}

describe('api-scb mappers (M9)', () => {
  it('mapSessionStatusFields projects session row', () => {
    const fields = mapSessionStatusFields({
      status: 'running',
      settlement_status: null,
      verified_running_at: '2026-07-03T10:00:00.000Z',
      verified_destroyed_at: null,
    });

    assert.equal(fields.sessionStatus, 'running');
    assert.equal(fields.settlementStatus, null);
    assert.equal(fields.verifiedRunningAt, '2026-07-03T10:00:00.000Z');
    assert.equal(fields.verifiedDestroyedAt, null);
  });

  it('mapRemainingStatusFields projects M2 OK result', () => {
    const fields = mapRemainingStatusFields({
      remaining: {
        state: REMAINING_STATE_OK,
        remainingHours: 3.5,
        totalEntitlementHours: 10,
        currentSessionElapsedHours: 0.5,
        settledSessionUsageHours: 6,
        primaryPlanType: 'combo',
      },
      walletBalance: 0,
    });

    assert.equal(fields.remainingHours, 3.5);
    assert.equal(fields.totalEntitlementHours, 10);
    assert.equal(fields.currentSessionElapsedHours, 0.5);
    assert.equal(fields.settledSessionUsageHours, 6);
  });

  it('mapDestroyApiResponse includes settlement and verify fields', () => {
    const payload = mapDestroyApiResponse({
      destroyed: true,
      backupSuccess: true,
      reason: 'user_stop',
      billingResult: { durationSeconds: 120, hoursUsed: 0.03 },
      metrics: { outputCount: 2 },
      settlementStatus: 'settled',
      verifiedDestroyedAt: '2026-07-03T11:00:00.000Z',
      verify: { state: 'ok' },
    });

    assert.equal(payload.success, true);
    assert.equal(payload.settlementStatus, 'settled');
    assert.equal(payload.verifiedDestroyedAt, '2026-07-03T11:00:00.000Z');
    assert.equal(payload.verifyStatus, 'ok');
    assert.equal(payload.billableSeconds, 120);
    assert.equal(payload.session.durationSeconds, 120);
    assert.equal(payload.session.outputCount, 2);
  });
});

describe('M9 API legacy caller removal', () => {
  const apiFiles = [
    'machines/status.js',
    'machines/destroy.js',
    'user/start-machine.js',
    'user/stop-machine.js',
    'user/cancel-start-machine.js',
    'dashboard/me.js',
  ];

  const forbidden = ['startBilling(', 'stopBilling(', 'deductPerMinute', 'applyBillingDeduction'];

  for (const file of apiFiles) {
    it(`${file} does not call legacy billing paths`, () => {
      const source = readApiSrc(file);
      for (const token of forbidden) {
        assert.ok(!source.includes(token), `${file} must not reference ${token}`);
      }
    });
  }

  it('status API delegates to projection handler for infra + auto-stop', () => {
    const source = readApiSrc('machines/status.js');
    const projection = readFileSync(path.join(__dirname, '../machines-status-projection.js'), 'utf8');
    assert.ok(source.includes('handleMachinesStatusProjectionFirst'));
    assert.ok(projection.includes('readRemainingForMachine'));
    assert.ok(projection.includes('checkAutoStop'));
    assert.ok(!projection.includes('buildBillingSessionView'));
  });

  it('destroy APIs use mapDestroyApiResponse', () => {
    assert.ok(readApiSrc('machines/destroy.js').includes('mapDestroyApiResponse'));
    assert.ok(readApiSrc('user/stop-machine.js').includes('mapDestroyApiResponse'));
  });

  it('destroy APIs do not fake success when provider destroy fails', () => {
    const destroySrc = readApiSrc('machines/destroy.js');
    const stopSrc = readApiSrc('user/stop-machine.js');
    assert.ok(destroySrc.includes('status(409)'));
    assert.ok(destroySrc.includes('result.destroyed && lifecycleRecord'));
    assert.ok(stopSrc.includes('status(409)'));
    assert.ok(stopSrc.includes('if (!result.destroyed)'));
    assert.ok(
      /if \(result\.destroyed && lifecycleRecord/.test(destroySrc) ||
        destroySrc.includes('if (result.destroyed && lifecycleRecord && subscription)'),
    );
  });

  it('cancel-start-machine interrupts pending session via M3', () => {
    const source = readApiSrc('user/cancel-start-machine.js');
    assert.ok(source.includes('interruptPendingSessionForUser'));
    assert.ok(source.includes('destroyMachineWithBackup'));
    assert.ok(source.includes('billingView'));
  });

  it('stop-machine returns machineSessionView and billingView', () => {
    const source = readApiSrc('user/stop-machine.js');
    assert.ok(source.includes('machineSessionView'));
    assert.ok(source.includes('billingView'));
    assert.ok(source.includes('resolveBillingViewForCommand'));
  });

  it('start-machine returns billingView on all success paths', () => {
    const source = readApiSrc('user/start-machine.js');
    assert.ok(source.includes('billingViewForStart'));
    assert.ok(source.includes('billingView'));
  });

  it('start-machine accepts boot via lifecycle SM and background provision', () => {
    const source = readApiSrc('user/start-machine.js');
    const provision = readFileSync(path.join(__dirname, 'user-start-provision.js'), 'utf8');
    assert.ok(source.includes('repairUserBillingState'));
    assert.ok(source.includes('persistStartRequested'));
    assert.ok(source.includes('machineSessionView'));
    assert.ok(source.includes('billingViewForStart'));
    assert.ok(source.includes('completeUserStartProvision'));
    assert.ok(source.includes('reclaimStaleProvisionClaim'));
    assert.ok(source.includes('buildProvisionAttemptLabel'));
    assert.ok(!source.includes('retry background provision'));
    assert.ok(provision.includes('createProvisioningPendingSession'));
    assert.ok(provision.includes('persistProviderRunning'));
    assert.ok(provision.includes('recoverRentedInstanceByLabel'));
    assert.ok(provision.includes("liveStatus.status === 'running'"));
    assert.ok(!source.includes('syncSubscriptionWithMachineState'));
  });

  it('dashboard/me reads remaining via M2 module', () => {
    const source = readApiSrc('dashboard/me.js');
    assert.ok(source.includes('resolveBillingSessionView'));
    assert.ok(source.includes('billingView'));
  });

  it('status API is infra-only (no billing session view in response)', () => {
    const source = readApiSrc('machines/status.js');
    const projection = readFileSync(path.join(__dirname, '../machines-status-projection.js'), 'utf8');
    assert.ok(source.includes('handleMachinesStatusProjectionFirst'));
    assert.ok(!projection.includes('buildBillingSessionView'));
    assert.ok(!projection.includes('loadActiveSessionRow'));
    assert.ok(!projection.includes('sessionDurationSeconds'));
  });
});

describe('session-start module (M9)', () => {
  it('session-start.js wires M3 + M4 without legacy billing', () => {
    const source = readFileSync(path.join(__dirname, 'session-start.js'), 'utf8');
    assert.ok(source.includes('verifyInstanceRunning'));
    assert.ok(source.includes('createPendingSession'));
    assert.ok(source.includes('activateRunningSession'));
    assert.ok(!source.includes('interruptSession'));
    assert.ok(!source.includes('INTERRUPT_REASON'));
    assert.ok(!source.includes('deductPerMinute'));
    assert.ok(!source.includes('applyBillingDeduction'));
    assert.ok(!source.includes('stopBilling'));
  });
});
