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

  it('status API uses openBillableSession', () => {
    const source = readApiSrc('machines/status.js');
    assert.ok(source.includes('openBillableSession'));
    assert.ok(source.includes('readRemainingForMachine'));
    assert.ok(source.includes('mapSessionStatusFields'));
  });

  it('destroy APIs use mapDestroyApiResponse', () => {
    assert.ok(readApiSrc('machines/destroy.js').includes('mapDestroyApiResponse'));
    assert.ok(readApiSrc('user/stop-machine.js').includes('mapDestroyApiResponse'));
  });

  it('cancel-start-machine interrupts pending session via M3', () => {
    const source = readApiSrc('user/cancel-start-machine.js');
    assert.ok(source.includes('interruptPendingSessionForUser'));
    assert.ok(source.includes('destroyMachineWithBackup'));
  });

  it('start-machine creates provisioning pending session', () => {
    const source = readApiSrc('user/start-machine.js');
    assert.ok(source.includes('createProvisioningPendingSession'));
    assert.ok(source.includes('repairUserBillingState'));
  });

  it('dashboard/me reads remaining via M2 module', () => {
    const source = readApiSrc('dashboard/me.js');
    assert.ok(source.includes('readRemainingForMachine'));
    assert.ok(source.includes('mapRemainingStatusFields'));
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
