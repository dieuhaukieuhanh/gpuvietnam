import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';

import {
  CAPTURE_STATUS_OFFICIAL,
  CAPTURE_STATUS_PLACEHOLDER,
  REQUIRED_CORE_NODE_CLASSES,
  buildPackAllowlist,
  filterObjectInfoByAllowlist,
  buildSupportedNodeManifest,
  validateSupportedNodeManifest,
  isAllowedPythonModule,
  hashOfficialNodesLock,
  defaultManifestPath,
  defaultObjectInfoPath,
  OFFICIAL_IMAGE_V3,
} from './supported-node-manifest.js';

function coreDef(name, python_module = 'nodes') {
  return {
    name,
    display_name: name,
    python_module,
    input: { required: {} },
    input_order: { required: [] },
    output: ['*'],
    output_is_list: [false],
    output_name: ['*'],
    output_node: false,
    category: 'test',
    description: '',
  };
}

describe('A1 M2 supported-node-manifest allowlist', () => {
  it('builds pack allowlist from official-nodes.lock profile v3', () => {
    const al = buildPackAllowlist('v3');
    assert.ok(al.packDirs.includes('ComfyUI-Impact-Pack'));
    assert.ok(al.packDirs.includes('ComfyUI-KJNodes'));
    assert.ok(!al.packDirs.includes('ComfyUI-AnimateDiff-Evolved')); // v4-only
    assert.match(al.lockSha256, /^[a-f0-9]{64}$/);
  });

  it('allows core + locked packs; rejects foreign custom nodes', () => {
    const al = buildPackAllowlist('v3');
    assert.equal(isAllowedPythonModule('nodes', al.packDirs), true);
    assert.equal(
      isAllowedPythonModule('comfy_extras.nodes_latent', al.packDirs),
      true,
    );
    assert.equal(
      isAllowedPythonModule('custom_nodes.ComfyUI-Impact-Pack', al.packDirs),
      true,
    );
    assert.equal(
      isAllowedPythonModule('custom_nodes.was-node-suite-comfyui', al.packDirs),
      false,
    );
    assert.equal(
      isAllowedPythonModule('custom_nodes.ComfyUI-AnimateDiff-Evolved', al.packDirs),
      false,
    );
  });

  it('filters object_info: core present, foreign packs excluded', () => {
    const al = buildPackAllowlist('v3');
    const raw = {
      KSampler: coreDef('KSampler'),
      CheckpointLoaderSimple: coreDef('CheckpointLoaderSimple'),
      CLIPTextEncode: coreDef('CLIPTextEncode'),
      EmptyLatentImage: coreDef('EmptyLatentImage'),
      VAEDecode: coreDef('VAEDecode'),
      SaveImage: coreDef('SaveImage'),
      ImpactThing: coreDef('ImpactThing', 'custom_nodes.ComfyUI-Impact-Pack'),
      WasNode: coreDef('WasNode', 'custom_nodes.was-node-suite-comfyui'),
      Animate: coreDef('Animate', 'custom_nodes.ComfyUI-AnimateDiff-Evolved'),
    };
    const filtered = filterObjectInfoByAllowlist(raw, al);
    assert.ok(filtered.objectInfo.KSampler);
    assert.ok(filtered.objectInfo.ImpactThing);
    assert.equal(filtered.objectInfo.WasNode, undefined);
    assert.equal(filtered.objectInfo.Animate, undefined);
    assert.equal(filtered.excludedNodeCount, 2);
  });

  it('validate fails on lock drift', () => {
    const al = buildPackAllowlist('v3');
    const objectInfo = Object.fromEntries(
      REQUIRED_CORE_NODE_CLASSES.map((n) => [n, coreDef(n)]),
    );
    const manifest = buildSupportedNodeManifest({
      captureStatus: CAPTURE_STATUS_PLACEHOLDER,
      objectInfo,
      allowlist: al,
      meta: { source: 'test', capturedAt: new Date().toISOString() },
    });
    manifest.provenance.lock_sha256 = '0'.repeat(64);
    const check = validateSupportedNodeManifest(manifest, objectInfo);
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes('lock drift')));
  });

  it('placeholder must not include pack nodes; official requires packs', () => {
    const al = buildPackAllowlist('v3');
    const withPack = {
      KSampler: coreDef('KSampler'),
      ImpactThing: coreDef('ImpactThing', 'custom_nodes.ComfyUI-Impact-Pack'),
    };
    const badPlaceholder = buildSupportedNodeManifest({
      captureStatus: CAPTURE_STATUS_PLACEHOLDER,
      objectInfo: withPack,
      allowlist: al,
      meta: { source: 'test', capturedAt: new Date().toISOString() },
    });
    const bad = validateSupportedNodeManifest(badPlaceholder, withPack);
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => e.includes('placeholder must not include')));

    const empty = {};
    const placeholder = buildSupportedNodeManifest({
      captureStatus: CAPTURE_STATUS_PLACEHOLDER,
      objectInfo: empty,
      allowlist: al,
      meta: {
        source: 'placeholder:no-capture',
        capturedAt: new Date().toISOString(),
        dockerImage: OFFICIAL_IMAGE_V3,
      },
    });
    const okPh = validateSupportedNodeManifest(placeholder, empty);
    assert.equal(okPh.ok, true);
    assert.equal(placeholder.complete, false);

    const coreOnly = Object.fromEntries(
      REQUIRED_CORE_NODE_CLASSES.map((n) => [n, coreDef(n)]),
    );
    const fakeOfficial = buildSupportedNodeManifest({
      captureStatus: CAPTURE_STATUS_OFFICIAL,
      objectInfo: coreOnly,
      allowlist: al,
      meta: {
        source: 'test',
        capturedAt: new Date().toISOString(),
        dockerImage: OFFICIAL_IMAGE_V3,
      },
    });
    const missPacks = validateSupportedNodeManifest(fakeOfficial, coreOnly, {
      requireOfficial: true,
    });
    assert.equal(missPacks.ok, false);
    assert.ok(missPacks.errors.some((e) => e.includes('missing locked pack')));
  });

  it('official validation fails when capture provenance missing', () => {
    const al = buildPackAllowlist('v3');
    const objectInfo = {};
    const manifest = buildSupportedNodeManifest({
      captureStatus: CAPTURE_STATUS_OFFICIAL,
      objectInfo,
      allowlist: al,
      meta: {},
    });
    const check = validateSupportedNodeManifest(manifest, objectInfo, {
      requireOfficial: true,
    });
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes('captured_at')));
  });

  it('lock hash is stable for current lock file', () => {
    const a = hashOfficialNodesLock();
    const b = hashOfficialNodesLock();
    assert.equal(a, b);
  });
});

describe('A1 M2 shipped catalog artifacts', () => {
  it('manifest + object_info exist and validate against current lock', () => {
    const mp = defaultManifestPath();
    const op = defaultObjectInfoPath();
    assert.equal(existsSync(mp), true, 'supported-node-manifest.v3.json missing');
    assert.equal(existsSync(op), true, 'supported-object_info.v3.json missing');
    const manifest = JSON.parse(readFileSync(mp, 'utf8'));
    const objectInfo = JSON.parse(readFileSync(op, 'utf8'));
    const check = validateSupportedNodeManifest(manifest, objectInfo);
    assert.equal(check.ok, true, check.errors.join('; '));
    assert.equal(manifest.version_pins.comfyui_frontend_package, '1.45.21');
    assert.equal(manifest.version_pins.comfyui_runtime, '0.28.0');
    assert.match(String(manifest.version_pins.docker_image), /v3\.2/);
  });

  it('if official, core nodes present; if placeholder, no pack claim', () => {
    const manifest = JSON.parse(readFileSync(defaultManifestPath(), 'utf8'));
    const objectInfo = JSON.parse(readFileSync(defaultObjectInfoPath(), 'utf8'));
    if (manifest.capture_status === CAPTURE_STATUS_OFFICIAL) {
      for (const n of REQUIRED_CORE_NODE_CLASSES) {
        assert.ok(objectInfo[n], `missing core ${n}`);
      }
      assert.ok(manifest.catalog.custom_node_dirs_included.length > 0);
    } else {
      assert.equal(manifest.capture_status, CAPTURE_STATUS_PLACEHOLDER);
      assert.equal(manifest.complete, false);
      assert.deepEqual(manifest.catalog.custom_node_dirs_included, []);
      assert.equal(manifest.policy.offline_extensions.length, 0);
    }
  });
});
