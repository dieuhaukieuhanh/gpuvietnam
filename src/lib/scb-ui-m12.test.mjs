import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  filterBillingHistorySessions,
  formatSettlementBreakdownSummary,
  formatVerifyStatusLabel,
  mapSessionApiToHistoryView,
  mapSessionsApiList,
} from './scb-session-history-view-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const componentsRoot = path.join(__dirname, '../components');

function readComponent(relativePath) {
  return readFileSync(path.join(componentsRoot, relativePath), 'utf8');
}

describe('scb-session-history-view-model (M12)', () => {
  it('mapSessionApiToHistoryView maps closed settled session from API shape', () => {
    const view = mapSessionApiToHistoryView({
      id: 's1',
      sessionNumber: 2,
      status: 'closed',
      statusLabel: '✅ Đã đóng',
      settlementStatus: 'settled',
      settlementStatusLabel: '✅ Đã quyết toán',
      billableSeconds: 600,
      billableLabel: '10 phút',
      durationLabel: '10 phút',
      verifiedDestroyedAt: '2026-07-03T11:00:00.000Z',
    });

    assert.equal(view?.settlementStatus, 'settled');
    assert.equal(view?.billableSeconds, 600);
    assert.equal(view?.isBillingHistory, true);
    assert.equal(view?.verifyStatusLabel, 'destroy verified');
  });

  it('formatVerifyStatusLabel uses verify timestamps only', () => {
    assert.equal(
      formatVerifyStatusLabel({ verifiedRunningAt: '2026-07-03T10:00:00.000Z' }),
      'running verified',
    );
    assert.equal(formatVerifyStatusLabel({ status: 'closed' }), null);
  });

  it('formatSettlementBreakdownSummary displays API breakdown keys', () => {
    const summary = formatSettlementBreakdownSummary({
      chargedSeconds: 120,
      walletCharge: 1000,
      allocations: [{ id: 'a1' }],
    });
    assert.ok(summary?.includes('Tính phí'));
    assert.ok(summary?.includes('Ví'));
    assert.ok(summary?.includes('entitlement'));
  });

  it('filterBillingHistorySessions keeps settled and skipped only', () => {
    const views = mapSessionsApiList([
      { id: '1', settlementStatus: 'settled' },
      { id: '2', settlementStatus: 'failed' },
      { id: '3', settlementStatus: 'skipped' },
    ]);
    const billing = filterBillingHistorySessions(views);
    assert.equal(billing.length, 2);
    assert.deepEqual(
      billing.map((v) => v.id),
      ['1', '3'],
    );
  });
});

describe('M12 session history legacy removal (grep)', () => {
  const files = [
    'dashboard/HistoryPanel.tsx',
    'dashboard/DashboardRecentSessionsCard.tsx',
    'pages/DashboardLichSuPage.tsx',
  ];

  const forbidden = [
    'hours_used',
    'hours_total',
    'billed_seconds',
    'duration_seconds',
    'liveDuration',
    'setNow(Date.now())',
    'setInterval(() => setNow',
    'hours_total - hours_used',
    'hours_total-hours_used',
  ];

  for (const file of files) {
    it(`${file} avoids legacy client billing math`, () => {
      const source = readComponent(file);
      for (const token of forbidden) {
        assert.ok(!source.includes(token), `${file} must not reference ${token}`);
      }
    });
  }

  it('HistoryPanel uses scb-session-history-view-model', () => {
    const source = readComponent('dashboard/HistoryPanel.tsx');
    assert.ok(source.includes('scb-session-history-view-model'));
    assert.ok(source.includes('settlementStatusLabel'));
    assert.ok(source.includes('billableLabel'));
    assert.ok(!source.includes('Date.now() - new Date'));
  });

  it('DashboardRecentSessionsCard uses API duration fields only', () => {
    const source = readComponent('dashboard/DashboardRecentSessionsCard.tsx');
    assert.ok(source.includes('mapSessionsApiList'));
    assert.ok(!source.includes('Date.now()'));
  });

  it('sessions API route returns SCB projection fields', () => {
    const source = readFileSync(path.join(__dirname, '../pages/api/user/sessions.js'), 'utf8');
    assert.ok(source.includes('mapSessionRow'));
    assert.ok(!source.includes('buildLiveSessionFromSubscription'));
  });

  it('gpu-sessions.js exposes SCB history projection helpers', () => {
    const source = readFileSync(path.join(__dirname, 'gpu-sessions.js'), 'utf8');
    assert.ok(source.includes('getScbSessionStatusLabel'));
    assert.ok(!source.includes('buildLiveSessionFromSubscription'));
    assert.ok(source.includes('settlementStatus'));
    assert.ok(source.includes('projectBillableSeconds'));
  });
});
