import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  WORKSPACE_RESTORE_PREFIXES,
  WORKSPACE_RESTORE_SMALL_BYTES_DEFAULT,
  resolveWorkspaceRestoreSmallBytes,
} from './workspace-restore-config.js';

describe('workspace-restore-config', () => {
  it('Level-1 prefixes exclude models and custom nodes', () => {
    assert.deepEqual([...WORKSPACE_RESTORE_PREFIXES], ['workflows', 'outputs', 'settings']);
    assert.ok(!WORKSPACE_RESTORE_PREFIXES.includes('models'));
  });

  it('default small threshold is 200MB', () => {
    assert.equal(WORKSPACE_RESTORE_SMALL_BYTES_DEFAULT, 200 * 1024 * 1024);
    const prev = process.env.WORKSPACE_RESTORE_SMALL_BYTES;
    delete process.env.WORKSPACE_RESTORE_SMALL_BYTES;
    assert.equal(resolveWorkspaceRestoreSmallBytes(), 200 * 1024 * 1024);
    process.env.WORKSPACE_RESTORE_SMALL_BYTES = '1048576';
    assert.equal(resolveWorkspaceRestoreSmallBytes(), 1048576);
    if (prev == null) delete process.env.WORKSPACE_RESTORE_SMALL_BYTES;
    else process.env.WORKSPACE_RESTORE_SMALL_BYTES = prev;
  });
});
