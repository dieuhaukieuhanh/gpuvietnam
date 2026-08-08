import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocateSlotsByDeficit } from './host-intelligence-targets.js';

describe('allocateSlotsByDeficit', () => {
  it('gives each below-target line at least one slot when budget allows', () => {
    const alloc = allocateSlotsByDeficit(
      ['rtx3090', 'rtx4090_1x', 'rtx5090_1x'],
      { rtx3090: 4, rtx4090_1x: 4, rtx5090_1x: 4 },
      { rtx3090: 3, rtx4090_1x: 1, rtx5090_1x: 0 },
      3,
    );
    assert.equal(alloc.rtx3090, 1);
    assert.equal(alloc.rtx4090_1x, 1);
    assert.equal(alloc.rtx5090_1x, 1);
  });

  it('prefers larger deficits when distributing extra slots', () => {
    const alloc = allocateSlotsByDeficit(
      ['rtx3090', 'rtx4090_1x', 'rtx5090_1x'],
      { rtx3090: 4, rtx4090_1x: 4, rtx5090_1x: 4 },
      { rtx3090: 3, rtx4090_1x: 2, rtx5090_1x: 0 },
      4,
    );
    // Pass1: 1 each. Pass2: one extra → 5090 (deficit 4)
    assert.equal(alloc.rtx5090_1x, 2);
    assert.equal(alloc.rtx3090, 1);
    assert.equal(alloc.rtx4090_1x, 1);
  });

  it('does not allocate above line deficit', () => {
    const alloc = allocateSlotsByDeficit(
      ['rtx5090_1x'],
      { rtx5090_1x: 4 },
      { rtx5090_1x: 3 },
      5,
    );
    assert.equal(alloc.rtx5090_1x, 1);
  });
});
