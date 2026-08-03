import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SaladProviderAdapter } from './salad-provider-adapter.js';
import { SALAD_CAPABILITIES } from '../../provider-abstraction/provider-capabilities.js';
import { isProviderAdapter } from '../../provider-abstraction/provider-interface.js';

describe('SaladProviderAdapter', () => {
  /** @type {SaladProviderAdapter} */
  let adapter;

  const makeAdapter = () =>
    new SaladProviderAdapter({
      apiKey: 'test-key',
      organization: 'test-org',
      project: 'test-project',
    });

  it('conforms to ProviderAdapter interface (9 methods)', () => {
    const a = makeAdapter();
    assert.ok(isProviderAdapter(a), 'should satisfy ProviderAdapter contract');
  });

  describe('getInfo', () => {
    it('returns correct provider identity', () => {
      const info = makeAdapter().getInfo();
      assert.equal(info.id, 'salad');
      assert.equal(info.name, 'SaladCloud');
      assert.equal(info.version, '1.0.0');
    });
  });

  describe('getCapabilities', () => {
    it('returns SALAD_CAPABILITIES with implemented=true', () => {
      const caps = makeAdapter().getCapabilities();
      assert.equal(caps.implemented, true);
      assert.equal(caps.billingGranularity, 'second');
      assert.deepEqual(caps.gpuTypes, ['rtx3090', 'rtx4090_1x', 'rtx5090_1x']);
      assert.equal(caps.startupLatency, 'low');
      assert.equal(caps.supportsSpot, true);
      assert.equal(caps.supportsDocker, true);
    });
  });

  describe('listOffers', () => {
    it('returns empty array (Salad has no marketplace)', async () => {
      const offers = await makeAdapter().listOffers();
      assert.deepEqual(offers, []);
    });
  });

  describe('listRegions', () => {
    it('returns global region only', async () => {
      const regions = await makeAdapter().listRegions();
      assert.equal(regions.length, 1);
      assert.equal(regions[0].id, 'global');
      assert.ok(regions[0].label.includes('Salad'));
    });
  });

  describe('health', () => {
    it('reports unhealthy when API not configured', async () => {
      const a = new SaladProviderAdapter({
        apiKey: null,
        organization: null,
        project: null,
      });
      const result = await a.health();
      assert.equal(result.healthy, false);
      assert.ok(
        result.message.includes('SALAD_API_KEY') || result.message.includes('SALAD_ORGANIZATION'),
        result.message,
      );
    });
  });

  describe('verifyRunning', () => {
    it('reports not running when container not found', async () => {
      const result = await makeAdapter().verifyRunning('nonexistent-group');
      assert.equal(result.running, false);
      assert.equal(result.normalizedState, 'stopped');
    });
  });

  describe('state mapping', () => {
    it('maps preparing → booting', async () => {
      const a = makeAdapter();
      a.client.getContainerGroup = async () => ({
        name: 'test',
        current_state: 'preparing',
        instances: [],
      });
      const machine = await a.getMachine('test');
      assert.equal(machine.status, 'booting');
    });

    it('maps running → running', async () => {
      const a = makeAdapter();
      a.client.getContainerGroup = async () => ({
        name: 'test',
        current_state: 'running',
        instances: [{ id: 'i1', state: 'running' }],
        networking: { dns: 'test.salad.cloud' },
      });
      const machine = await a.getMachine('test');
      assert.equal(machine.status, 'running');
      assert.ok(machine.endpointUrl);
    });

    it('maps failed → stopped', async () => {
      const a = makeAdapter();
      a.client.getContainerGroup = async () => ({
        name: 'test',
        current_state: 'failed',
        instances: [],
      });
      const machine = await a.getMachine('test');
      assert.equal(machine.status, 'stopped');
    });
  });
});
