import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RunpodClient } from './runpod-client.js';

describe('RunpodClient.createInstance', () => {
  it('walks candidates and cancels orphan before next host', async () => {
    const cancelled = [];
    const rented = [];
    const client = new RunpodClient({ apiKey: 'test-key' });
    client.listRentCandidates = async () => [{ offerId: 'a' }, { offerId: 'b' }];
    client.rentOffer = async (c) => {
      rented.push(c.offerId);
      if (c.offerId === 'a') throw new Error('runpod rent a failed');
      return { id: c.offerId, providerId: 'runpod' };
    };
    client.cancelOrphanForOffer = async (c) => {
      cancelled.push(c.offerId);
    };

    const result = await client.createInstance({ gpuLine: 'rtx4090_1x' });
    assert.equal(result.id, 'b');
    assert.deepEqual(rented, ['a', 'b']);
    assert.deepEqual(cancelled, ['a']);
  });

  it('rejects when API key missing', async () => {
    const client = new RunpodClient({ apiKey: null });
    await assert.rejects(
      () => client.createInstance({ gpuLine: 'rtx4090_1x' }),
      /RUNPOD_API_KEY/,
    );
  });
});
