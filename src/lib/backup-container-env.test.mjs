import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { injectBackupContainerEnv } from './backup-container-env.js';

describe('injectBackupContainerEnv', () => {
  it('injects backup token + presign + report URL, never R2 secrets', () => {
    const env = injectBackupContainerEnv(
      { GPUVIETNAM_WORKSTATION: 'character-art' },
      {
        userId: 'u1',
        backupToken: 'gvb.test',
        presignUrl: 'https://app.example/api/storage/presign-upload',
        skipModels: true,
        flushSecret: 'flush-sec',
        planKey: 'pro',
      },
    );
    assert.equal(env.GPUVIETNAM_BACKUP_TOKEN, 'gvb.test');
    assert.equal(env.GPUVIETNAM_PRESIGN_URL, 'https://app.example/api/storage/presign-upload');
    assert.equal(env.GPUVIETNAM_BACKUP_REPORT_URL, 'https://app.example/api/storage/backup-report');
    assert.equal(env.GPUVIETNAM_BACKUP_SKIP_MODELS, '1');
    assert.equal(env.GPUVIETNAM_BACKUP_FLUSH_SECRET, 'flush-sec');
    assert.equal(env.GPUVIETNAM_USER_ID, 'u1');
    assert.equal(env.GPUVIETNAM_BACKUP_OUTPUTS_INTERVAL, '180');
    assert.equal(env.GPUVIETNAM_BACKUP_WORKFLOWS_INTERVAL, '600');
    assert.equal(env.R2_SECRET_ACCESS_KEY, undefined);
    assert.equal(env.R2_ACCESS_KEY_ID, undefined);
  });

  it('uses starter intervals by default when planKey omitted', () => {
    const env = injectBackupContainerEnv(
      {},
      {
        backupToken: 'gvb.test',
        presignUrl: 'https://app.example/api/storage/presign-upload',
      },
    );
    assert.equal(env.GPUVIETNAM_BACKUP_OUTPUTS_INTERVAL, String(10 * 60));
    assert.equal(env.GPUVIETNAM_BACKUP_WORKFLOWS_INTERVAL, String(20 * 60));
  });

  it('uses studio intervals for studio plan', () => {
    const env = injectBackupContainerEnv(
      {},
      {
        backupToken: 'gvb.test',
        presignUrl: 'https://app.example/api/storage/presign-upload',
        planKey: 'studio',
      },
    );
    assert.equal(env.GPUVIETNAM_BACKUP_OUTPUTS_INTERVAL, '60');
    assert.equal(env.GPUVIETNAM_BACKUP_WORKFLOWS_INTERVAL, '300');
  });

  it('omits backup env when token/url missing', () => {
    const env = injectBackupContainerEnv({}, {});
    assert.equal(env.GPUVIETNAM_BACKUP_TOKEN, undefined);
    assert.equal(env.GPUVIETNAM_PRESIGN_URL, undefined);
    assert.equal(env.GPUVIETNAM_BACKUP_OUTPUTS_INTERVAL, undefined);
  });

  it('honors intervalsByPlan override', () => {
    const env = injectBackupContainerEnv(
      {},
      {
        backupToken: 'gvb.test',
        presignUrl: 'https://app.example/api/storage/presign-upload',
        planKey: 'starter',
        intervalsByPlan: {
          starter: { outputsSec: 90, workflowsSec: 180 },
          pro: { outputsSec: 180, workflowsSec: 600 },
          studio: { outputsSec: 60, workflowsSec: 300 },
        },
      },
    );
    assert.equal(env.GPUVIETNAM_BACKUP_OUTPUTS_INTERVAL, '90');
    assert.equal(env.GPUVIETNAM_BACKUP_WORKFLOWS_INTERVAL, '180');
  });
});
