import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countDistinctHosts,
  evaluateDualRunCapacity,
  resolveDualRunGpuLine,
} from './dual-run-capacity.js';
import { applyDualRunPriceMultiplier } from './dual-run-policy.js';

describe('cp-runtime dual-run capacity / gpu line', () => {
  it('resolves GPU line from active machine, then plan', () => {
    assert.equal(
      resolveDualRunGpuLine({ activeGpuLine: 'rtx4090_1x', planKey: 'studio' }),
      'rtx4090_1x',
    );
    assert.equal(resolveDualRunGpuLine({ planKey: 'pro' }), 'rtx4090_1x');
    assert.equal(resolveDualRunGpuLine({ planKey: 'studio' }), 'rtx5090_1x');
    assert.equal(resolveDualRunGpuLine({ planKey: 'starter' }), 'rtx3090');
  });

  it('counts distinct physical hosts and respects excludes', () => {
    assert.equal(
      countDistinctHosts([
        'vast-host:1|rtx4090_1x',
        'vast-host:2|rtx4090_1x',
        'vast-host:1|rtx4090_1x',
      ]),
      2,
    );
    assert.equal(
      countDistinctHosts(
        ['vast-host:1|rtx4090_1x', 'vast-host:2|rtx4090_1x'],
        ['vast-host:1'],
      ),
      1,
    );
    assert.equal(evaluateDualRunCapacity({ distinctHostCount: 1 }).ok, false);
    assert.equal(evaluateDualRunCapacity({ distinctHostCount: 2 }).ok, true);
  });

  it('applies admin price multiplier with hard cap', () => {
    const priced = applyDualRunPriceMultiplier(10_000, {
      customerMultiplier: 1.5,
      hardCapMultiplier: 1.9,
    });
    assert.equal(priced.dualCharge, 15_000);
    assert.equal(priced.effectiveMultiplier, 1.5);
  });
});
