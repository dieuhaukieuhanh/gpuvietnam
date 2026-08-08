import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProviderRoutingPolicy,
  getProviderRoutingPolicySync,
  _resetProviderRoutingPolicyCacheForTests as resetCache,
  DEFAULT_PROVIDER_ROUTING_POLICY,
} from './provider-routing-policy.js';
import { resolveProviderAttemptOrder } from './provider-routing.js';

describe('provider-routing-policy', () => {
  const prev = { ...process.env };

  beforeEach(() => {
    resetCache();
    delete process.env.GPU_VAST_ONLY;
    delete process.env.GPU_CLORE_ONLY;
    delete process.env.GPU_SALAD_ONLY;
    delete process.env.GPUVIETNAM_LIFECYCLE_WORKER;
    delete process.env.GPU_ALLOW_VAST;
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
    resetCache();
  });

  it('normalizes and never allows all-off', () => {
    const p = normalizeProviderRoutingPolicy({
      providers: { vast: false, clore: false, salad: false },
      priority: ['clore', 'vast'],
    });
    assert.equal(p.providers.vast, true);
    assert.deepEqual(p.priority.slice(0, 2), ['clore', 'vast']);
  });

  it('default policy is Vast-only', () => {
    assert.equal(DEFAULT_PROVIDER_ROUTING_POLICY.providers.vast, true);
    assert.equal(DEFAULT_PROVIDER_ROUTING_POLICY.providers.clore, false);
  });

  it('resolve order uses policy when no emergency env', () => {
    const policy = normalizeProviderRoutingPolicy({
      providers: { vast: true, clore: true, salad: false },
      priority: ['clore', 'vast', 'salad'],
    });
    assert.deepEqual(
      resolveProviderAttemptOrder({ gpuLine: 'rtx4090_1x', policy }),
      ['clore', 'vast'],
    );
    assert.deepEqual(
      resolveProviderAttemptOrder({ gpuLine: 'rtx5090_1x', policy }),
      ['clore', 'vast'],
    );
  });

  it('emergency GPU_VAST_ONLY beats policy', () => {
    process.env.GPU_VAST_ONLY = 'true';
    const policy = normalizeProviderRoutingPolicy({
      providers: { vast: true, clore: true, salad: true },
      priority: ['salad', 'clore', 'vast'],
    });
    assert.deepEqual(
      resolveProviderAttemptOrder({ gpuLine: 'rtx4090_1x', policy }),
      ['vast'],
    );
  });

  it('sync getter returns a policy object', () => {
    const p = getProviderRoutingPolicySync();
    assert.ok(p.providers);
    assert.ok(Array.isArray(p.priority));
  });
});
