import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GPU_IMAGE_V3, GPU_IMAGE_V4 } from './gpu/gpu-config.js';
import { resolveMachineImage } from './machines-image-resolve.js';

describe('resolveMachineImage (machines.image projection)', () => {
  it('prefers context.image', () => {
    assert.equal(
      resolveMachineImage({ metadata: {} }, { gpuLine: 'rtx3090', image: 'repo:custom' }),
      'repo:custom',
    );
  });

  it('reads metadata.image then provider raw', () => {
    assert.equal(
      resolveMachineImage({ metadata: { image: 'repo:meta' } }, { gpuLine: 'rtx3090' }),
      'repo:meta',
    );
    assert.equal(
      resolveMachineImage(
        { metadata: { clore: { image: 'dieuhaukieuhanh/gpuvietnam-comfyui:v3' } } },
        { gpuLine: 'rtx5090_1x' },
      ),
      'dieuhaukieuhanh/gpuvietnam-comfyui:v3',
    );
    assert.equal(
      resolveMachineImage(
        { metadata: { vast: { image: 'dieuhaukieuhanh/gpuvietnam-comfyui:v4' } } },
        { gpuLine: 'rtx3090' },
      ),
      'dieuhaukieuhanh/gpuvietnam-comfyui:v4',
    );
  });

  it('falls back to resolveGpuImage by gpu_line', () => {
    assert.equal(resolveMachineImage({}, { gpuLine: 'rtx3090' }), GPU_IMAGE_V3);
    assert.equal(resolveMachineImage({}, { gpuLine: 'rtx4090_1x' }), GPU_IMAGE_V3);
    assert.equal(resolveMachineImage({}, { gpuLine: 'rtx5090_1x' }), GPU_IMAGE_V4);
  });
});
