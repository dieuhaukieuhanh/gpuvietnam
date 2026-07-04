import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { REMAINING_INVALID_STATE, REMAINING_STATE_OK } from './remaining-time.js';
import { mapRemainingResultToBillingCredit } from './billing-projection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readGpuSrc(filename) {
  return readFileSync(path.join(__dirname, filename), 'utf8');
}

describe('mapRemainingResultToBillingCredit (M5)', () => {
  it('maps OK remaining breakdown to billing credit fields', () => {
    const result = mapRemainingResultToBillingCredit(
      {
        state: REMAINING_STATE_OK,
        remainingHours: 2.5,
        totalEntitlementHours: 5,
        settledSessionUsageHours: 1,
        currentSessionElapsedHours: 1.5,
        primaryPlanType: 'combo',
      },
      100000,
    );

    assert.equal(result.effectiveHoursRemaining, 2.5);
    assert.equal(result.hoursRemaining, 5);
    assert.equal(result.planType, 'combo');
    assert.equal(result.walletBalance, 100000);
  });

  it('returns null credit fields on invalid remaining state', () => {
    const result = mapRemainingResultToBillingCredit(
      {
        state: REMAINING_INVALID_STATE,
        code: 'MULTIPLE_RUNNING_SESSIONS',
        message: 'invalid',
        runningSessionCount: 2,
      },
      0,
    );

    assert.equal(result.effectiveHoursRemaining, null);
    assert.equal(result.hoursRemaining, null);
    assert.equal(result.planType, null);
  });
});

describe('M5 legacy tick removal', () => {
  it('billing.js does not define deductPerMinute', () => {
    const source = readGpuSrc('billing.js');
    assert.ok(!source.includes('deductPerMinute'));
    assert.ok(!source.includes('MINUTE_BILLING_SECONDS'));
    assert.ok(!source.includes('getUnbilledSeconds'));
    assert.ok(!source.includes('updateSessionBilledSeconds'));
  });

  it('auto-stop.js does not call deductPerMinute', () => {
    const source = readFileSync(path.join(__dirname, 'auto-stop.js'), 'utf8');
    assert.ok(!source.includes('deductPerMinute'));
  });

  it('machines status API does not call deductPerMinute', () => {
    const source = readFileSync(
      path.join(__dirname, '../../pages/api/machines/status.js'),
      'utf8',
    );
    assert.ok(!source.includes('deductPerMinute'));
    assert.ok(!source.includes('startBilling'));
  });

  it('index.js does not export deductPerMinute', () => {
    const source = readGpuSrc('index.js');
    assert.ok(!source.includes('deductPerMinute'));
    assert.ok(!source.includes('startBilling'));
    assert.ok(!source.includes('stopBilling'));
  });

  it('billing.js does not define applyBillingDeduction (M6)', () => {
    assert.ok(!readGpuSrc('billing.js').includes('applyBillingDeduction'));
  });
});

describe('M8 auto-stop read-only', () => {
  it('auto-stop.js does not call stopBilling', () => {
    const source = readGpuSrc('auto-stop.js');
    assert.ok(!source.includes('stopBilling'));
  });

  it('auto-stop.js does not call destroyMachineWithBackup', () => {
    const source = readGpuSrc('auto-stop.js');
    assert.ok(!source.includes('destroyMachineWithBackup'));
  });

  it('auto-stop.js delegates destroy to runUnifiedDestroy', () => {
    const source = readGpuSrc('auto-stop.js');
    assert.ok(source.includes('runUnifiedDestroy'));
  });

  it('auto-stop.js uses M2 isOutOfCredit via auto-stop-core', () => {
    const source = readGpuSrc('auto-stop.js');
    assert.ok(!source.match(/function isOutOfCredit\s*\(/));
    assert.ok(source.includes('shouldStopForOutOfCredit'));
  });

  it('auto-stop.js does not import VastProvider directly', () => {
    const source = readGpuSrc('auto-stop.js');
    assert.ok(!source.includes('VastProvider'));
  });
});
