import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '../..');

function readSrc(relativePath) {
  return readFileSync(path.join(root, 'src', relativePath), 'utf8');
}

function readProject(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

describe('M14 reconciliation wiring', () => {
  it('cron route uses executeReconciliation', () => {
    const source = readSrc('pages/api/cron/reconcile-infrastructure.js');
    assert.ok(source.includes('executeReconciliation'));
    assert.ok(source.includes('reconcile-infrastructure'));
  });

  it('admin reconcile route supports GET history and POST run', () => {
    const source = readSrc('pages/api/admin/infrastructure/reconcile.js');
    assert.ok(source.includes('fetchReconciliationRuns'));
    assert.ok(source.includes('executeReconciliation'));
    assert.ok(!source.includes('settleSession('));
  });

  it('reconciliation-run wires gpu service without importing billing index barrel', () => {
    const source = readSrc('lib/infrastructure/reconciliation-run.js');
    assert.ok(source.includes('createGpuService'));
    assert.ok(!source.includes("from '../gpu/index.js'"));
    assert.ok(source.includes('runInfrastructureReconciliation'));
    assert.ok(source.includes('persistReconciliationRun'));
  });
});

describe('M14 final legacy grep', () => {
  const forbiddenGlobal = [
    'deductPerMinute',
    'applyBillingDeduction',
    'buildLiveSessionFromSubscription',
    'TODO M2',
    'TODO M3',
    'TODO SCB',
    'RECONCILIATION_STUB_MESSAGE',
  ];

  const srcFiles = [
    'lib/gpu/billing.js',
    'lib/gpu/index.js',
    'lib/gpu-sessions.js',
    'components/dashboard/HistoryPanel.tsx',
    'components/dashboard/DashboardOverview.tsx',
    'pages/api/user/sessions.js',
  ];

  for (const file of srcFiles) {
    it(`${file} has no forbidden legacy tokens`, () => {
      const source = readSrc(file);
      for (const token of forbiddenGlobal) {
        assert.ok(!source.includes(token), `${file} must not reference ${token}`);
      }
    });
  }

  it('index.js does not export startBilling or stopBilling', () => {
    const source = readSrc('lib/gpu/index.js');
    assert.ok(!source.includes('startBilling'));
    assert.ok(!source.includes('stopBilling'));
  });

  it('vercel.json schedules reconciliation cron', () => {
    const source = readProject('vercel.json');
    assert.ok(source.includes('reconcile-infrastructure'));
  });

  it('AdminReconciliationPanel calls reconcile API only', () => {
    const source = readSrc('components/admin/AdminReconciliationPanel.tsx');
    assert.ok(source.includes('/api/admin/infrastructure/reconcile'));
    assert.ok(!source.includes('settleSession'));
    assert.ok(!source.includes('runDestroyPipeline'));
  });
});

describe('M14 architecture audit markers', () => {
  it('remaining-time module exists (M2 SoT)', () => {
    const source = readSrc('lib/gpu/remaining-time.js');
    assert.ok(source.includes('calculateRemaining'));
  });

  it('session-lifecycle module exists (M3 SoT)', () => {
    const source = readSrc('lib/gpu/session-lifecycle.js');
    assert.ok(source.includes('executeCommand'));
  });

  it('settlement module exists (M6 SoT)', () => {
    const source = readSrc('lib/gpu/settlement.js');
    assert.ok(source.includes('settleSession'));
  });

  it('destroy pipeline exists (M7 SoT)', () => {
    const source = readSrc('lib/destroy-pipeline-run.js');
    assert.ok(source.includes('runDestroyPipeline'));
  });

  it('reconciliation domain exists (M13 SoT)', () => {
    const source = readSrc('lib/infrastructure/reconciliation.js');
    assert.ok(source.includes('repairDriftItem'));
  });
});
