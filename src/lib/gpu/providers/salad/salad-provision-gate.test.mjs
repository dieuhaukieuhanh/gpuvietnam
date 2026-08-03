import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSystemStatsVramGate } from './salad-provision-gate.js';

describe('parseSystemStatsVramGate', () => {
  it('passes when VRAM meets minimum', () => {
    const stats = {
      devices: [{ name: 'NVIDIA GeForce RTX 4090', vram_total: 24, type: 'cuda' }],
    };
    const result = parseSystemStatsVramGate(stats, 'rtx4090_1x', 24);
    assert.equal(result.ok, true);
    assert.ok(result.vramGb >= 24);
  });

  it('fails when VRAM below minimum', () => {
    const stats = {
      devices: [{ name: 'NVIDIA GeForce RTX 4090', vram_total: 8, type: 'cuda' }],
    };
    const result = parseSystemStatsVramGate(stats, 'rtx4090_1x', 24);
    assert.equal(result.ok, false);
    assert.ok(result.detail.includes('VRAM check failed'));
  });

  it('fails when no CUDA device', () => {
    const stats = {
      devices: [{ name: 'CPU', type: 'cpu' }],
    };
    const result = parseSystemStatsVramGate(stats, 'rtx4090_1x', 24);
    assert.equal(result.ok, false);
  });

  it('handles devices as object', () => {
    const stats = {
      devices: {
        0: { name: 'NVIDIA GeForce RTX 3090', vram_total: 24, type: 'cuda' },
      },
    };
    const result = parseSystemStatsVramGate(stats, 'rtx3090', 24);
    assert.equal(result.ok, true);
    assert.ok(result.vramGb >= 24);
  });

  it('matches GPU name with token-based lookup', () => {
    const stats = {
      devices: [{ name: 'NVIDIA GeForce RTX3090', vram_total: 24, type: 'cuda' }],
    };
    const result = parseSystemStatsVramGate(stats, 'rtx3090', 24);
    assert.equal(result.ok, true);
  });

  it('fails on GPU name mismatch', () => {
    const stats = {
      devices: [{ name: 'NVIDIA GeForce GTX 1080', vram_total: 8, type: 'cuda' }],
    };
    const result = parseSystemStatsVramGate(stats, 'rtx4090_1x', 24);
    assert.equal(result.ok, false);
    assert.ok(result.detail.includes('GPU name mismatch') || result.detail.includes('VRAM check failed'));
  });

  it('verifies minimum VRAM for RTX 5090', () => {
    const stats = {
      devices: [{ name: 'NVIDIA GeForce RTX 5090', vram_total: 32, type: 'cuda' }],
    };
    const result = parseSystemStatsVramGate(stats, 'rtx5090_1x', 32);
    assert.equal(result.ok, true);
    assert.ok(result.vramGb >= 32);
  });

  it('rejects empty devices array', () => {
    const stats = { devices: [] };
    const result = parseSystemStatsVramGate(stats, 'rtx3090', 24);
    assert.equal(result.ok, false);
  });

  it('rejects null stats', () => {
    const result = parseSystemStatsVramGate(null, 'rtx3090', 24);
    assert.equal(result.ok, false);
  });
});
