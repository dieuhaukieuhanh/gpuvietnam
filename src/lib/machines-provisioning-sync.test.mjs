import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  shouldRepairBootingSubscriptionDrift,
  shouldResetIdleProvisioningSubscription,
  shouldSkipDeadInstanceDestroyDuringBoot,
} from './machines-provisioning-sync.js';

const NOW = new Date('2026-07-03T12:00:00.000Z').getTime();
const RECENT = new Date(NOW - 2 * 60 * 1000).toISOString();
const OLD = new Date(NOW - 20 * 60 * 1000).toISOString();

describe('machines provisioning sync (boot race)', () => {
  it('does not reset provisioning while Vast rent has no machine row yet', () => {
    assert.equal(shouldResetIdleProvisioningSubscription(null, 'provisioning'), false);
  });

  it('repairs offline subscription when booting machine was just inserted', () => {
    const machine = { status: 'creating', created_at: RECENT, instance_id: '12345' };
    assert.equal(shouldRepairBootingSubscriptionDrift(machine, 'offline', NOW), true);
  });

  it('does not repair leaked machine after stale boot window', () => {
    const machine = { status: 'creating', created_at: OLD, instance_id: '12345' };
    assert.equal(shouldRepairBootingSubscriptionDrift(machine, 'offline', NOW), false);
  });

  it('skips dead-instance destroy for recent booting machine on 404', () => {
    const machine = { status: 'starting', created_at: RECENT, instance_id: '12345' };
    assert.equal(
      shouldSkipDeadInstanceDestroyDuringBoot(machine, 'Instance not found (404)', NOW),
      true,
    );
  });

  it('still destroys old booting machine on 404', () => {
    const machine = { status: 'starting', created_at: OLD, instance_id: '12345' };
    assert.equal(
      shouldSkipDeadInstanceDestroyDuringBoot(machine, 'Instance not found (404)', NOW),
      false,
    );
  });
});
