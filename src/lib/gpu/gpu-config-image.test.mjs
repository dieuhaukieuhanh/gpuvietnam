import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GPU_IMAGE_BY_LINE,
  GPU_IMAGE_V3,
  GPU_IMAGE_V4,
  DEFAULT_GPU_IMAGE,
  PACKAGE_SPECS,
  OFFER_SELECTION,
  resolveGpuImage,
} from './gpu-config.js';

describe('resolveGpuImage (dual-image supply strategy)', () => {
  it('maps 3090/4090 → v3 and 5090 → v4', () => {
    assert.equal(resolveGpuImage('rtx3090'), GPU_IMAGE_BY_LINE.rtx3090);
    assert.equal(resolveGpuImage('rtx4090_1x'), GPU_IMAGE_BY_LINE.rtx4090_1x);
    assert.equal(resolveGpuImage('rtx4090_2x'), GPU_IMAGE_BY_LINE.rtx4090_2x);
    assert.equal(resolveGpuImage('rtx5090_1x'), GPU_IMAGE_BY_LINE.rtx5090_1x);
    assert.equal(GPU_IMAGE_BY_LINE.rtx3090, GPU_IMAGE_V3);
    assert.equal(GPU_IMAGE_BY_LINE.rtx4090_1x, GPU_IMAGE_V3);
    assert.equal(GPU_IMAGE_BY_LINE.rtx5090_1x, GPU_IMAGE_V4);
    assert.notEqual(GPU_IMAGE_V3, GPU_IMAGE_V4);
    assert.equal(DEFAULT_GPU_IMAGE, GPU_IMAGE_V4);
  });

  it('unknown line defaults to v3 (maximize supply)', () => {
    assert.equal(resolveGpuImage(null), GPU_IMAGE_V3);
    assert.equal(resolveGpuImage(''), GPU_IMAGE_V3);
  });

  it('FORCE overrides all lines', () => {
    const prev = process.env.GPUVIETNAM_COMFYUI_IMAGE_FORCE;
    process.env.GPUVIETNAM_COMFYUI_IMAGE_FORCE = 'dieuhaukieuhanh/gpuvietnam-comfyui:forced';
    try {
      assert.equal(resolveGpuImage('rtx3090'), 'dieuhaukieuhanh/gpuvietnam-comfyui:forced');
      assert.equal(resolveGpuImage('rtx5090_1x'), 'dieuhaukieuhanh/gpuvietnam-comfyui:forced');
    } finally {
      if (prev === undefined) delete process.env.GPUVIETNAM_COMFYUI_IMAGE_FORCE;
      else process.env.GPUVIETNAM_COMFYUI_IMAGE_FORCE = prev;
    }
  });
});

describe('PACKAGE_SPECS Studio CUDA floor', () => {
  it('Studio requires higher CUDA soft floor than shared default', () => {
    assert.equal(PACKAGE_SPECS.studio.minCudaVersion, 12.0);
    assert.ok(PACKAGE_SPECS.studio.minCudaVersion > OFFER_SELECTION.minCudaVersion);
    assert.equal(PACKAGE_SPECS.starter.minCudaVersion, undefined);
  });
});
