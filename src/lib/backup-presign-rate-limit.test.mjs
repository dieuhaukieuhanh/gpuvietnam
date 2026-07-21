import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  checkBackupPresignRateLimit,
  resetBackupPresignRateLimit,
} from './backup-presign-rate-limit.js';

describe('checkBackupPresignRateLimit', () => {
  beforeEach(() => {
    resetBackupPresignRateLimit();
  });

  it('allows under the max', () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      const r = checkBackupPresignRateLimit('tok', { max: 5, windowMs: 60_000, now: now + i });
      assert.equal(r.ok, true);
    }
  });

  it('blocks when max exceeded', () => {
    const now = 2_000_000;
    for (let i = 0; i < 3; i += 1) {
      assert.equal(checkBackupPresignRateLimit('tok', { max: 3, windowMs: 60_000, now }).ok, true);
    }
    const blocked = checkBackupPresignRateLimit('tok', { max: 3, windowMs: 60_000, now: now + 10 });
    assert.equal(blocked.ok, false);
    assert.ok(blocked.retryAfterSec >= 1);
  });

  it('isolates keys', () => {
    const now = 3_000_000;
    assert.equal(checkBackupPresignRateLimit('a', { max: 1, now }).ok, true);
    assert.equal(checkBackupPresignRateLimit('a', { max: 1, now: now + 1 }).ok, false);
    assert.equal(checkBackupPresignRateLimit('b', { max: 1, now: now + 1 }).ok, true);
  });
});