import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  SPEC_ID_V3,
  SPEC_ID_V4,
  buildRuntimeImageSpec,
  defaultOfficialNodesLockPath,
  evaluateImageSpecParity,
  getRuntimeImageSpec,
  inferImageSpecRefFromDockerImage,
  normalizeModelRelativeKey,
  parseOfficialNodesLock,
  resolveImageSpecRefForGpuLine,
} from './runtime-image-spec.js';

describe('cp-runtime runtime-image-spec', () => {
  it('parses official-nodes.lock and builds v3/v4 catalogs', () => {
    const text = readFileSync(defaultOfficialNodesLockPath(), 'utf8');
    const locked = parseOfficialNodesLock(text);
    assert.ok(locked.some((n) => n.dir === 'ComfyUI-Impact-Pack'));
    assert.ok(locked.some((n) => n.dir === 'ComfyUI-AnimateDiff-Evolved'));

    const v3 = buildRuntimeImageSpec('v3', { locked });
    const v4 = buildRuntimeImageSpec('v4', { locked });
    assert.equal(v3.spec_id, SPEC_ID_V3);
    assert.equal(v4.spec_id, SPEC_ID_V4);
    assert.ok(v3.custom_nodes.some((n) => n.dir === 'ComfyUI-Impact-Pack'));
    assert.ok(!v3.custom_nodes.some((n) => n.dir === 'ComfyUI-AnimateDiff-Evolved'));
    assert.ok(v4.custom_nodes.some((n) => n.dir === 'ComfyUI-AnimateDiff-Evolved'));
    assert.deepEqual(v4.satisfies_spec_ids, [SPEC_ID_V3, SPEC_ID_V4]);
    assert.ok(v3.extensions.includes('gpuvietnam_backup'));
    assert.ok(v3.extensions.includes('gpuvietnam_cp_sync'));
  });

  it('resolves spec ref from GPU line and docker image', () => {
    assert.equal(resolveImageSpecRefForGpuLine('rtx3090'), SPEC_ID_V3);
    assert.equal(resolveImageSpecRefForGpuLine('rtx4090_1x'), SPEC_ID_V3);
    assert.equal(resolveImageSpecRefForGpuLine('rtx5090_1x'), SPEC_ID_V4);
    assert.equal(
      inferImageSpecRefFromDockerImage('dieuhaukieuhanh/gpuvietnam-comfyui:v3'),
      SPEC_ID_V3,
    );
    assert.equal(
      inferImageSpecRefFromDockerImage('dieuhaukieuhanh/gpuvietnam-comfyui:v4'),
      SPEC_ID_V4,
    );
  });

  it('parity: v4 runtime satisfies v3 job; v3 cannot run v4-only nodes', () => {
    const ok = evaluateImageSpecParity({
      requiredSpecId: SPEC_ID_V3,
      runtimeSpecId: SPEC_ID_V4,
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.code, 'ok');

    const mismatch = evaluateImageSpecParity({
      requiredSpecId: SPEC_ID_V4,
      runtimeSpecId: SPEC_ID_V3,
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'profile_mismatch');

    const gap = evaluateImageSpecParity({
      requiredSpecId: SPEC_ID_V3,
      runtimeSpecId: SPEC_ID_V3,
      requiredNodes: ['ComfyUI-AnimateDiff-Evolved'],
    });
    assert.equal(gap.ok, false);
    assert.deepEqual(gap.missing.nodes, ['ComfyUI-AnimateDiff-Evolved']);
  });

  it('parity: stock models and user model overrides', () => {
    const miss = evaluateImageSpecParity({
      requiredSpecId: SPEC_ID_V3,
      runtimeSpecId: SPEC_ID_V3,
      requiredModels: ['checkpoints/missing.safetensors'],
    });
    assert.equal(miss.ok, false);
    assert.ok(miss.missing.models.includes('checkpoints/missing.safetensors'));

    const stockOk = evaluateImageSpecParity({
      requiredSpecId: SPEC_ID_V3,
      runtimeSpecId: SPEC_ID_V3,
      requiredModels: ['stock/models/checkpoints/sd_xl_base_1.0.safetensors'],
    });
    assert.equal(stockOk.ok, true);

    const userOk = evaluateImageSpecParity({
      requiredSpecId: SPEC_ID_V3,
      runtimeSpecId: SPEC_ID_V3,
      requiredModels: ['checkpoints/my-lora-or-ckpt.safetensors'],
      availableUserModels: ['checkpoints/my-lora-or-ckpt.safetensors'],
    });
    assert.equal(userOk.ok, true);
  });

  it('catalog get + normalize helpers', () => {
    assert.equal(getRuntimeImageSpec(SPEC_ID_V3)?.profile, 'v3');
    assert.equal(getRuntimeImageSpec('nope'), null);
    assert.equal(
      normalizeModelRelativeKey('stock/models/checkpoints/a.safetensors'),
      'checkpoints/a.safetensors',
    );
    const missing = evaluateImageSpecParity({
      requiredSpecId: null,
      runtimeSpecId: SPEC_ID_V3,
    });
    assert.equal(missing.code, 'missing_spec_ref');
  });
});
