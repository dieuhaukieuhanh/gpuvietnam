import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';

import {
  detectProvisionFailureDrift,
  isScb21ReadPathDetectOnly,
  toSyncShape,
} from './machines-drift-core.js';

describe('machines-drift (SCB 2.1 Phase 1)', () => {
  const originalFlag = process.env.SCB21_READ_PATH_DETECT_ONLY;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.SCB21_READ_PATH_DETECT_ONLY;
    } else {
      process.env.SCB21_READ_PATH_DETECT_ONLY = originalFlag;
    }
  });

  it('isScb21ReadPathDetectOnly defaults ON unless env is 0', () => {
    delete process.env.SCB21_READ_PATH_DETECT_ONLY;
    assert.equal(isScb21ReadPathDetectOnly(), true);

    process.env.SCB21_READ_PATH_DETECT_ONLY = '0';
    assert.equal(isScb21ReadPathDetectOnly(), false);
  });

  it('detectProvisionFailureDrift returns destroy repair for error live status', () => {
    const machine = { id: 'm1', subscription_id: 'sub1' };
    const result = detectProvisionFailureDrift(machine, {
      status: 'error',
      message: 'boot failed',
    });

    assert.equal(result?.changed, true);
    assert.equal(result?.action, 'provision_failed_destroy');
    assert.equal(result?.machine, null);
    assert.equal(result?.repair?.kind, 'destroy_and_subscription_offline');
    assert.equal(result?.repair?.subscriptionId, 'sub1');
    assert.equal(result?.repair?.destroyOptions?.reason, 'provision_failed');
    assert.equal(result?.repair?.destroyOptions?.skipBilling, true);
  });

  it('detectProvisionFailureDrift ignores non-error live status', () => {
    const machine = { id: 'm1', subscription_id: 'sub1' };
    assert.equal(detectProvisionFailureDrift(machine, { status: 'starting' }), null);
  });

  it('toSyncShape strips repair payload for legacy sync callers', () => {
    const shaped = toSyncShape({
      changed: true,
      machine: null,
      subscription: { id: 'sub1', server_status: 'offline' },
      action: 'reset_orphan_online',
      repair: { kind: 'update_subscription', subscriptionId: 'sub1', serverStatus: 'offline' },
    });

    assert.deepEqual(shaped, {
      changed: true,
      machine: null,
      subscription: { id: 'sub1', server_status: 'offline' },
      action: 'reset_orphan_online',
    });
    assert.equal('repair' in shaped, false);
  });
});
