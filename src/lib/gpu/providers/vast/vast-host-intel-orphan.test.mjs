import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyVastHostIntelOrphans,
  normalizeVastHostIntelInstance,
} from './vast-host-intel-orphan.js';

describe('vast-host-intel-orphan', () => {
  it('normalizes start_date seconds to ms', () => {
    const n = normalizeVastHostIntelInstance({
      id: 1,
      label: 'gpuvietnam-host-intel',
      start_date: 1786204152,
      actual_status: 'running',
    });
    assert.equal(n?.id, '1');
    assert.equal(n?.startMs, 1786204152 * 1000);
  });

  it('waits inside grace, destroys after grace', () => {
    const nowMs = 1_000_000;
    const graceMs = 60_000;
    const rows = [
      normalizeVastHostIntelInstance({
        id: 'young',
        label: 'gpuvietnam-host-intel',
        start_date: (nowMs - 10_000) / 1000,
        actual_status: 'running',
      }),
      normalizeVastHostIntelInstance({
        id: 'old',
        label: 'gpuvietnam-host-intel',
        start_date: (nowMs - 120_000) / 1000,
        actual_status: 'running',
      }),
      normalizeVastHostIntelInstance({
        id: 'customer',
        label: 'gv-customer',
        start_date: (nowMs - 120_000) / 1000,
        actual_status: 'running',
      }),
    ];
    const decisions = classifyVastHostIntelOrphans(rows, { nowMs, graceMs });
    assert.equal(decisions.length, 2);
    assert.equal(decisions.find((d) => d.id === 'young')?.action, 'wait');
    assert.equal(decisions.find((d) => d.id === 'old')?.action, 'destroy');
  });
});
