import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  backupKeyCategory,
  evaluateBackupKeyAgainstQuota,
} from './backup-quota.js';

describe('evaluateBackupKeyAgainstQuota', () => {
  it('allows outputs when over quota', () => {
    const r = evaluateBackupKeyAgainstQuota('outputs/a.png', { overQuota: true, skipModels: true });
    assert.equal(r.ok, true);
  });

  it('rejects models when over quota', () => {
    const r = evaluateBackupKeyAgainstQuota('models/loras/x.safetensors', {
      overQuota: true,
      skipModels: true,
    });
    assert.equal(r.ok, false);
  });

  it('rejects models larger than remaining', () => {
    const r = evaluateBackupKeyAgainstQuota(
      'models/loras/x.safetensors',
      { overQuota: false, skipModels: false },
      { sizeBytes: 500, remainingBytes: 100 },
    );
    assert.equal(r.ok, false);
  });
});

describe('backupKeyCategory', () => {
  it('maps prefixes', () => {
    assert.equal(backupKeyCategory('workflows/a.json'), 'workflow');
    assert.equal(backupKeyCategory('models/x'), 'model');
    assert.equal(backupKeyCategory('outputs/x'), 'output');
  });
});