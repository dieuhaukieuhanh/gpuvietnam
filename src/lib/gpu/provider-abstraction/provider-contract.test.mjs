/**
 * SCB 2.1 Phase 3 — Provider adapter contract tests.
 * Every registered adapter must pass the same structural + behavioral contract.
 */

import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

import {
  bootstrapProviderRegistry,
  getProviderAdapter,
  listRegisteredProviders,
  resetProviderRegistryForTests,
} from '../provider-abstraction/index.js';
import { isProviderAdapter, PROVIDER_ADAPTER_METHODS } from '../provider-abstraction/provider-interface.js';
import { runProviderAdapterContract } from '../provider-abstraction/provider-contract-runner.js';
import { createMockProviderAdapter } from '../provider-abstraction/provider-contract-mock.js';
import { VastProviderAdapter } from '../providers/vast/vast-provider-adapter.js';

describe('provider adapter contract (Phase 3)', () => {
  after(() => {
    resetProviderRegistryForTests();
  });

  it('mock adapter passes full contract', async () => {
    const mock = createMockProviderAdapter();
    await runProviderAdapterContract(mock);
  });

  it('isProviderAdapter validates required methods', () => {
    const mock = createMockProviderAdapter();
    assert.equal(isProviderAdapter(mock), true);
    assert.equal(isProviderAdapter({}), false);
    assert.equal(PROVIDER_ADAPTER_METHODS.length, 9);
  });

  describe('registry', () => {
    before(() => {
      resetProviderRegistryForTests();
      bootstrapProviderRegistry();
    });

    it('registers exactly clore, vast, salad, runpod', () => {
      const providers = listRegisteredProviders();
      const ids = providers.map((p) => p.id).sort();
      assert.deepEqual(ids, [
        'clore',
        'runpod',
        'salad',
        'vast',
      ]);
    });

    it('vast adapter passes contract (platform health + listRegions)', async () => {
      const adapter = getProviderAdapter('vast');
      assert.equal(isProviderAdapter(adapter), true);
      const info = adapter.getInfo();
      assert.equal(info.id, 'vast');
      const caps = adapter.getCapabilities();
      assert.equal(caps.implemented, true);
      assert.equal(caps.supportsSpot, true);
      const regions = await adapter.listRegions();
      assert.ok(regions.length > 0);
      const health = await adapter.health();
      assert.ok(typeof health.healthy === 'boolean');
    });

    it('salad + runpod stubs expose capabilities but listOffers empty', async () => {
      const salad = getProviderAdapter('salad');
      assert.equal(salad.getCapabilities().implemented, false);
      const offers = await salad.listOffers({ gpuLine: 'rtx4090_1x' });
      assert.deepEqual(offers, []);

      const runpod = getProviderAdapter('runpod');
      assert.equal(runpod.getCapabilities().implemented, false);
      const runpodOffers = await runpod.listOffers({ gpuLine: 'rtx4090_1x' });
      assert.deepEqual(runpodOffers, []);
    });
  });

  it('vast adapter delegates createMachine to legacy provider', async () => {
    let destroyed = false;
    const legacyProvider = {
      createInstance: async () => ({
        id: 'inst-1',
        providerId: 'vast',
        gpuLine: 'rtx4090_1x',
        status: { code: 'starting' },
      }),
      destroyInstance: async () => {
        destroyed = true;
      },
      getInstanceStatus: async () => ({
        id: 'inst-1',
        providerId: 'vast',
        gpuLine: 'rtx4090_1x',
        status: { code: 'running' },
      }),
      healthCheck: async () => ({
        code: 'running',
        healthy: true,
        checkedAt: new Date().toISOString(),
      }),
    };

    const client = {
      searchOffers: async () => [
        {
          id: 1,
          rentable: true,
          num_gpus: 1,
          gpu_ram: 24576,
          reliability: 0.999,
          disk_space: 80,
          inet_down: 500,
          geolocation: 'Taiwan',
          dph_total: 0.5,
          gpu_name: 'RTX 4090',
        },
      ],
    };

    const adapter = new VastProviderAdapter({ legacyProvider, client });
    await runProviderAdapterContract(adapter, { skipVerifyRunning: true });

    const machine = await adapter.createMachine({ gpuLine: 'rtx4090_1x' });
    assert.equal(machine.id, 'inst-1');
    await adapter.destroyMachine('inst-1');
    assert.equal(destroyed, true);

    const offers = await adapter.listOffers({ gpuLine: 'rtx4090_1x', limit: 5 });
    assert.ok(Array.isArray(offers));
  });
});
