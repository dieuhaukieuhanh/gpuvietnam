import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALLOWED_BACKUP_PREFIXES,
  BACKUP_TOKEN_PREFIX,
  buildUserBackupR2Key,
  hashBackupToken,
  sanitizeBackupObjectKey,
} from './machine-backup-token.js';

describe('sanitizeBackupObjectKey', () => {
  it('allows outputs/workflows/models prefixes', () => {
    for (const prefix of ALLOWED_BACKUP_PREFIXES) {
      const r = sanitizeBackupObjectKey(`${prefix}/a/b.png`);
      assert.equal(r.ok, true);
      assert.equal(r.key, `${prefix}/a/b.png`);
    }
  });

  it('rejects path traversal and empty segments', () => {
    assert.equal(sanitizeBackupObjectKey('outputs/../etc/passwd').ok, false);
    assert.equal(sanitizeBackupObjectKey('outputs//x').ok, false);
    assert.equal(sanitizeBackupObjectKey('../outputs/x').ok, false);
    assert.equal(sanitizeBackupObjectKey('').ok, false);
  });

  it('rejects non-allowlisted roots', () => {
    assert.equal(sanitizeBackupObjectKey('secrets/key').ok, false);
    assert.equal(sanitizeBackupObjectKey('/etc/passwd').ok, false);
  });

  it('normalizes leading slashes', () => {
    const r = sanitizeBackupObjectKey('/outputs/foo.png');
    assert.equal(r.ok, true);
    assert.equal(r.key, 'outputs/foo.png');
    assert.equal(sanitizeBackupObjectKey('outputs/foo bar.png').ok, false);
  });
});

describe('buildUserBackupR2Key', () => {
  it('nests under users/{userId}/', () => {
    assert.equal(
      buildUserBackupR2Key('u1', 'outputs/a.png'),
      'users/u1/outputs/a.png',
    );
  });
});

describe('hashBackupToken', () => {
  it('is stable sha256 hex', () => {
    const a = hashBackupToken(`${BACKUP_TOKEN_PREFIX}abc`);
    const b = hashBackupToken(`${BACKUP_TOKEN_PREFIX}abc`);
    assert.equal(a, b);
    assert.match(a, /^[a-f0-9]{64}$/);
  });
});