import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SaladClient } from './salad-client.js';

describe('SaladClient.createInstance', () => {
  it('walks candidates and cancels orphan before next host', async () => {
    const cancelled = [];
    const rented = [];
    const client = new SaladClient({ apiKey: 'test-key' });
    client.listRentCandidates = async () => [{ offerId: 'a' }, { offerId: 'b' }];
    client.rentOffer = async (c) => {
      rented.push(c.offerId);
      if (c.offerId === 'a') throw new Error('salad rent a failed');
      return { id: c.offerId, providerId: 'salad' };
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
    const client = new SaladClient({ apiKey: null });
    await assert.rejects(
      () => client.createInstance({ gpuLine: 'rtx4090_1x' }),
      /SALAD_API_KEY/,
    );
  });
});
