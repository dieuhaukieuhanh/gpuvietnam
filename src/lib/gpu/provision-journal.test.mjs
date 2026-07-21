import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildProvisionJournalEntry,
  extractGateStepFlags,
  summarizeProvisionJournal,
} from './provision-journal.js';

describe('extractGateStepFlags', () => {
  it('reads http-first steps', () => {
    const f = extractGateStepFlags([
      { step: 'http_endpoint', ok: true, elapsedMs: 1000 },
      { step: 'gpu_stats', ok: true, elapsedMs: 2000 },
      { step: 'comfy_smoke', ok: true, elapsedMs: 3000 },
      { step: 'ssh_exec', ok: false, elapsedMs: 500 },
    ]);
    assert.equal(f.httpEndpointOk, true);
    assert.equal(f.systemStatsOk, true);
    assert.equal(f.promptSmokeOk, true);
    assert.equal(f.sshOk, false);
  });
});

describe('buildProvisionJournalEntry', () => {
  it('marks RUNNING when rent+gate ok', () => {
    const e = buildProvisionJournalEntry({
      provider: 'clore',
      hostId: '123',
      offerId: 123,
      instanceId: '999',
      rentOk: true,
      httpPub: true,
      gateOk: true,
      gateSteps: [
        { step: 'http_endpoint', ok: true },
        { step: 'gpu_stats', ok: true },
        { step: 'comfy_smoke', ok: true },
        { step: 'ssh_exec', ok: false },
      ],
      ops: { ssh_ok: false, ops_degraded: true },
      rentedAtMs: 1000,
      finishedAtMs: 4000,
    });
    assert.equal(e.finalStatus, 'RUNNING');
    assert.equal(e.opsDegraded, true);
    assert.equal(e.promptSmokeOk, true);
    assert.equal(e.timingsMs.rentToFinishMs, 3000);
  });

  it('marks FAILED with fail step', () => {
    const e = buildProvisionJournalEntry({
      provider: 'clore',
      rentOk: true,
      httpPub: true,
      gateOk: false,
      gateStep: 'http_endpoint',
      gateDetail: 'Proxy Not Found',
      failCategory: 'http_endpoint',
      gateSteps: [{ step: 'http_endpoint', ok: false }],
    });
    assert.equal(e.finalStatus, 'FAILED');
    assert.equal(e.failStep, 'http_endpoint');
    assert.match(String(e.failReason), /Proxy Not Found/);
  });
});

describe('summarizeProvisionJournal', () => {
  it('computes funnel percents', () => {
    const rows = [
      buildProvisionJournalEntry({
        provider: 'clore',
        rentOk: true,
        httpPub: true,
        gateOk: true,
        gateSteps: [
          { step: 'http_endpoint', ok: true },
          { step: 'gpu_stats', ok: true },
          { step: 'comfy_smoke', ok: true },
        ],
      }),
      buildProvisionJournalEntry({
        provider: 'clore',
        rentOk: true,
        httpPub: true,
        gateOk: false,
        gateStep: 'http_endpoint',
        gateDetail: 'Proxy Not Found',
        failCategory: 'http_endpoint',
        gateSteps: [{ step: 'http_endpoint', ok: false }],
      }),
    ];
    const s = summarizeProvisionJournal(rows, { provider: 'clore' });
    assert.equal(s.total, 2);
    assert.equal(s.funnel.rentOk.count, 2);
    assert.equal(s.funnel.running.count, 1);
    assert.equal(s.funnel.running.pct, 50);
    assert.equal(s.failByStep.http_endpoint, 1);
  });
});
