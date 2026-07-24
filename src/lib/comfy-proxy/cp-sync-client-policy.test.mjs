import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveComfySyncPatchOutcome,
  WORKSPACE_OFFLINE_EXTENSIONS,
  classifyRuntimeProbe,
  shouldWarnBeforeUnload,
} from './cp-sync-client-policy.js';
import { offlineBootStub } from '../../../workers/comfy-proxy/src/workspace-shell.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');

describe('A1 M3 CP sync client policy', () => {
  it('never overwrites server on REVISION_CONFLICT', () => {
    const out = resolveComfySyncPatchOutcome({
      status: 409,
      data: {
        code: 'REVISION_CONFLICT',
        workflow: { revision: 9, document: { nodes: [{ id: 1 }] } },
      },
    });
    assert.equal(out.action, 'conflict_take_server');
    assert.equal(out.overwriteServerWithoutExpected, false);
  });

  it('treats empty overwrite skip as non-destructive', () => {
    const out = resolveComfySyncPatchOutcome({
      status: 200,
      data: { ok: true, skipped: 'empty_document_overwrite' },
    });
    assert.equal(out.action, 'skipped_empty');
    assert.equal(out.overwriteServerWithoutExpected, false);
  });

  it('Workspace offline extensions include only cp_sync client', () => {
    assert.deepEqual(WORKSPACE_OFFLINE_EXTENSIONS, [
      '/extensions/gpuvietnam_cp_sync/cp_sync.js',
    ]);
    const stub = offlineBootStub('/extensions', 'GET');
    assert.deepEqual(stub?.body, WORKSPACE_OFFLINE_EXTENSIONS);
  });

  it('vendored cp_sync.js is present for Workspace static', () => {
    const p = join(
      root,
      'workers/comfy-proxy/public/extensions/gpuvietnam_cp_sync/cp_sync.js',
    );
    assert.equal(existsSync(p), true, 'run scripts/vendor-cp-sync-extension.mjs');
  });

  it('classifies Runtime probe for disconnect banner', () => {
    assert.equal(classifyRuntimeProbe({ ok: true, status: 200, body: {} }).online, true);
    assert.equal(
      classifyRuntimeProbe({
        ok: true,
        status: 200,
        body: { a1: { runtimeOnline: false, mode: 'editor' } },
      }).online,
      false,
    );
    assert.equal(classifyRuntimeProbe({ ok: false, status: 502 }).online, false);
    assert.equal(classifyRuntimeProbe({ ok: false, status: 426 }).kind, 'unreachable');
    assert.equal(classifyRuntimeProbe({ networkError: true }).online, false);
    assert.equal(classifyRuntimeProbe({ ok: false, status: 401 }).online, null);
  });

  it('beforeunload only when dirty and sync ready', () => {
    assert.equal(shouldWarnBeforeUnload({ syncReady: true, dirty: true }), true);
    assert.equal(shouldWarnBeforeUnload({ syncReady: true, dirty: false }), false);
    assert.equal(shouldWarnBeforeUnload({ syncReady: false, dirty: true }), false);
  });
});
