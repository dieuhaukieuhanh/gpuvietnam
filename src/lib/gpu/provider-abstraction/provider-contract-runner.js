/**
 * Shared provider adapter contract runner — used by all provider contract tests.
 */

import assert from 'node:assert/strict';
import { isProviderAdapter } from './provider-interface.js';

/**
 * @param {import('./provider-interface.js').ProviderAdapter} adapter
 * @param {{ skipVerifyRunning?: boolean }} [options]
 */
export async function runProviderAdapterContract(adapter, options = {}) {
  assert.equal(isProviderAdapter(adapter), true, 'adapter must implement ProviderAdapter');

  const info = adapter.getInfo();
  assert.ok(info.id, 'getInfo().id required');
  assert.ok(info.name, 'getInfo().name required');
  assert.ok(info.version, 'getInfo().version required');

  const caps = adapter.getCapabilities();
  assert.equal(typeof caps.supportsSpot, 'boolean');
  assert.equal(typeof caps.supportsReserved, 'boolean');
  assert.equal(typeof caps.supportsDocker, 'boolean');
  assert.ok(Array.isArray(caps.gpuTypes));
  assert.ok(Array.isArray(caps.regions));

  const regions = await adapter.listRegions();
  assert.ok(Array.isArray(regions));

  const offers = await adapter.listOffers({ gpuLine: 'rtx4090_1x', limit: 3 });
  assert.ok(Array.isArray(offers));

  const platformHealth = await adapter.health();
  assert.equal(typeof platformHealth.healthy, 'boolean');
  assert.ok(platformHealth.checkedAt);

  const machine = await adapter.createMachine({ gpuLine: 'rtx4090_1x' });
  assert.ok(machine.id);

  const fetched = await adapter.getMachine(String(machine.id));
  assert.equal(String(fetched.id), String(machine.id));

  const instanceHealth = await adapter.health(String(machine.id));
  assert.equal(typeof instanceHealth.healthy, 'boolean');

  if (!options.skipVerifyRunning) {
    const verify = await adapter.verifyRunning(String(machine.id));
    assert.equal(typeof verify.running, 'boolean');
    assert.ok(verify.checkedAt);
  }

  await adapter.destroyMachine(String(machine.id));
}
