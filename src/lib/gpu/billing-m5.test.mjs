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

  it('buildRemainingSnapshot loads plans/sessions/wallet when prefetch is omitted', () => {
    const source = readGpuSrc('billing.js');
    const fnStart = source.indexOf('async function buildRemainingSnapshot');
    assert.ok(fnStart !== -1);
    const fnEnd = source.indexOf('\n}\n\n\n/**', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.ok(body.includes('fetchOrderedBillablePlans'), 'must load billable plans');
    assert.ok(body.includes('fetchUserSessionsForRemaining'), 'must load sessions');
    assert.ok(body.includes("from('users')"), 'must load wallet balance');
    assert.ok(body.includes('prefetch.plans'), 'must honor prefetch plans');
    assert.ok(body.includes('plans === undefined'), 'must skip load when prefetched');
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

describe('M4 — billing no longer mutates session lifecycle', () => {
  it('billing.js source contains no legacy status string literals', () => {
    const source = readGpuSrc('billing.js');
    assert.ok(!source.includes("'interrupted'"), 'must not reference interrupted');
    assert.ok(!source.includes("'completed'"), 'must not reference completed');
    assert.ok(!source.includes("'closing'"), 'must not reference closing');
  });

  it('billing.js source contains no status / ended_at writes to gpu_sessions', () => {
    const source = readGpuSrc('billing.js');
    assert.ok(!source.includes("status: 'interrupted'"), 'must not write status=interrupted');
    assert.ok(!source.includes("status: 'completed'"), 'must not write status=completed');
    assert.ok(!source.includes("status: 'closing'"), 'must not write status=closing');
    assert.ok(!source.includes('patch.status ='), 'must not assign patch.status');
    assert.ok(!source.includes('patch.ended_at ='), 'must not assign patch.ended_at');
    assert.ok(!source.includes('ended_at: now'), 'must not write ended_at: now');
    assert.ok(!source.includes('ended_at: billingResult.endedAt'), 'must not write ended_at from billingResult');
  });

  it('finalizeGpuSession metrics typedef no longer carries interrupted flag', () => {
    const source = readGpuSrc('billing.js');
    assert.ok(!source.includes('interrupted?: boolean'));
    assert.ok(!source.includes('metrics.interrupted'));
  });

  it('closeSessionWithoutCharge writes only usage fields (duration_seconds + output_summary)', () => {
    const source = readGpuSrc('billing.js');
    const fnStart = source.indexOf('async function closeSessionWithoutCharge');
    assert.ok(fnStart !== -1, 'closeSessionWithoutCharge must exist');
    const fnEnd = source.indexOf('\n}', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.ok(body.includes('duration_seconds: 0'), 'should zero duration_seconds');
    assert.ok(body.includes('output_summary: reason'), 'should record output_summary reason');
    assert.ok(!body.includes('status:'), 'must not write status');
    assert.ok(!body.includes('ended_at'), 'must not write ended_at');
    assert.ok(!body.includes(".eq('status', 'running')"), 'must not gate on lifecycle status');
  });

  it('finalizeGpuSession writes only usage fields and is idempotent / status-agnostic', () => {
    const source = readGpuSrc('billing.js');
    const fnStart = source.indexOf('export async function finalizeGpuSession');
    assert.ok(fnStart !== -1, 'finalizeGpuSession must exist');
    const fnEnd = source.indexOf('\n}', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.ok(body.includes('duration_seconds: durationSeconds'), 'should write duration_seconds');
    assert.ok(body.includes('vram_avg_pct: metrics.vramAvg'), 'should write vram_avg_pct');
    assert.ok(body.includes('output_count: outputCount'), 'should write output_count');
    assert.ok(body.includes('output_summary: outputSummary'), 'should write output_summary');
    assert.ok(!body.includes('patch.status'), 'must not write status');
    assert.ok(!body.includes('patch.ended_at'), 'must not write ended_at');
    assert.ok(!body.includes("'closed'"), 'must not branch on closed status');
    assert.ok(!body.includes("'running'"), 'must not branch on running status');
    assert.ok(body.includes("if (!existing) return null"), 'must no-op when session row missing (idempotent)');
  });

  it('settleLinkedSessionWithoutCharge no longer references completed', () => {
    const source = readGpuSrc('billing.js');
    const fnStart = source.indexOf('async function settleLinkedSessionWithoutCharge');
    const fnEnd = source.indexOf('\n}', fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.ok(!body.includes("'completed'"), 'must not reference completed');
    assert.ok(body.includes("session?.status === 'closed'"), 'should settle only when closed');
  });
});
