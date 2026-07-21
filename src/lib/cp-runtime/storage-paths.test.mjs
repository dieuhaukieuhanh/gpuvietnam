import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAttemptLogKey,
  buildAttemptOutputKey,
  buildAttemptSidecarKey,
  buildJobInputKey,
  buildManifestEntry,
  buildProjectAssetKey,
  buildResultManifest,
  buildStockModelKey,
  isCpDurableObjectKey,
  isStockObjectKey,
} from './storage-paths.js';

const UID = 'user-abc_01';
const JOB = 'job-xyz_02';
const PROJ = 'proj-01';
const ASSET = 'asset-01';

describe('cp-runtime storage-paths', () => {
  it('builds Plane B keys', () => {
    assert.equal(
      buildJobInputKey(UID, JOB, 'photo.png'),
      `users/${UID}/cp/jobs/${JOB}/inputs/photo.png`,
    );
    assert.equal(
      buildAttemptOutputKey(UID, JOB, 2, 'out.png'),
      `users/${UID}/cp/jobs/${JOB}/attempts/2/outputs/out.png`,
    );
    assert.equal(
      buildAttemptLogKey(UID, JOB, 1, 'stderr.txt'),
      `users/${UID}/cp/jobs/${JOB}/attempts/1/logs/stderr.txt`,
    );
    assert.equal(
      buildAttemptSidecarKey(UID, JOB, 1, 'meta.json'),
      `users/${UID}/cp/jobs/${JOB}/attempts/1/sidecar/meta.json`,
    );
    assert.equal(
      buildProjectAssetKey(UID, PROJ, ASSET, 'mask.png'),
      `users/${UID}/cp/projects/${PROJ}/assets/${ASSET}/mask.png`,
    );
  });

  it('rejects path traversal and bad attempt numbers', () => {
    assert.throws(() => buildJobInputKey(UID, JOB, '../x.png'));
    assert.throws(() => buildJobInputKey(UID, JOB, 'a/b.png'));
    assert.throws(() => buildAttemptOutputKey(UID, JOB, 0, 'x.png'));
    assert.throws(() => buildAttemptOutputKey(UID, 'job/../x', 1, 'x.png'));
  });

  it('normalizes stock model keys', () => {
    assert.equal(
      buildStockModelKey('checkpoints/a.safetensors'),
      'stock/models/checkpoints/a.safetensors',
    );
    assert.equal(
      buildStockModelKey('models/checkpoints/a.safetensors'),
      'stock/models/checkpoints/a.safetensors',
    );
    assert.equal(
      buildStockModelKey('stock/models/checkpoints/a.safetensors'),
      'stock/models/checkpoints/a.safetensors',
    );
    assert.throws(() => buildStockModelKey('../etc/passwd'));
  });

  it('classifies plane keys', () => {
    assert.equal(isCpDurableObjectKey(`users/${UID}/cp/jobs/${JOB}/inputs/a.png`), true);
    assert.equal(isCpDurableObjectKey(`users/${UID}/outputs/a.png`), false);
    assert.equal(isStockObjectKey('stock/models/checkpoints/a.safetensors'), true);
  });

  it('builds result manifest v1', () => {
    const input = buildManifestEntry({
      kind: 'input',
      assetId: ASSET,
      r2Key: buildJobInputKey(UID, JOB, 'photo.png'),
      filename: 'photo.png',
      contentType: 'image/png',
      bytes: 10,
    });
    const output = buildManifestEntry({
      kind: 'output',
      r2Key: buildAttemptOutputKey(UID, JOB, 1, 'out.png'),
      filename: 'out.png',
      bytes: 20,
    });
    const manifest = buildResultManifest({
      inputs: [input],
      outputs: [output],
      model_refs: [
        buildManifestEntry({
          filename: 'a.safetensors',
          r2Key: buildStockModelKey('checkpoints/a.safetensors'),
          source: 'stock',
        }),
      ],
    });
    assert.equal(manifest.schema, 'cp.storage.manifest.v1');
    assert.equal(manifest.inputs.length, 1);
    assert.equal(manifest.outputs[0].filename, 'out.png');
    assert.equal(manifest.model_refs[0].source, 'stock');
  });
});
