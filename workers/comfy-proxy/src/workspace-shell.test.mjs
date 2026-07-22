import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isWorkspaceStaticPath,
  isWorkspaceOwnedExtensionPath,
  isRuntimeExecutionPath,
  isRuntimeLiveCatalogPath,
  offlineBootStub,
} from './workspace-shell.js';

describe('A1 M1–M4 workspace-shell', () => {
  it('classifies FE static paths', () => {
    assert.equal(isWorkspaceStaticPath('/'), true);
    assert.equal(isWorkspaceStaticPath('/assets/index-abc.js'), true);
    assert.equal(isWorkspaceOwnedExtensionPath('/extensions/core/x.js'), true);
    assert.equal(isWorkspaceStaticPath('/extensions/core/x.js'), true);
    assert.equal(isWorkspaceStaticPath('/extensions/gpuvietnam_cp_sync/cp_sync.js'), true);
    // M4: pack extensions are NOT Workspace-owned (proxy Runtime when online)
    assert.equal(isWorkspaceStaticPath('/extensions/ComfyUI-Impact-Pack/js/foo.js'), false);
    assert.equal(isWorkspaceStaticPath('/api/settings'), false);
    assert.equal(isWorkspaceStaticPath('/prompt'), false);
  });

  it('classifies execution and live catalog paths', () => {
    assert.equal(isRuntimeExecutionPath('/api/prompt'), true);
    assert.equal(isRuntimeExecutionPath('/prompt'), true);
    assert.equal(isRuntimeExecutionPath('/api/view'), true);
    assert.equal(isRuntimeExecutionPath('/api/settings'), false);
    assert.equal(isRuntimeLiveCatalogPath('/api/object_info'), true);
    assert.equal(isRuntimeLiveCatalogPath('/extensions'), true);
    assert.equal(isRuntimeLiveCatalogPath('/api/history'), true);
  });

  it('stubs settings and cp_sync extension list offline', () => {
    const settings = offlineBootStub('/api/settings', 'GET');
    assert.equal(settings?.status, 200);
    assert.equal(settings?.body['Comfy.InstalledVersion'], '1.45.21');

    const ext = offlineBootStub('/api/extensions', 'GET');
    assert.equal(ext?.status, 200);
    assert.deepEqual(ext?.body, ['/extensions/gpuvietnam_cp_sync/cp_sync.js']);

    const prompt = offlineBootStub('/api/prompt', 'POST');
    assert.equal(prompt?.status, 503);
    assert.equal(prompt?.body.code, 'A1_RUNTIME_OFFLINE');
  });

  it('M2: GET /api/object_info serves Supported Manifest snapshot', () => {
    const oi = offlineBootStub('/api/object_info', 'GET');
    assert.equal(oi?.status, 200);
    assert.equal(typeof oi?.body, 'object');
    assert.ok(oi?.body && !Array.isArray(oi.body));

    const missing = offlineBootStub('/api/object_info/DefinitelyNotASupportedNode', 'GET');
    assert.equal(missing?.status, 404);
    assert.equal(missing?.body?.code, 'A1_UNSUPPORTED_NODE');
  });
});
