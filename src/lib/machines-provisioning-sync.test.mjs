import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  shouldRepairBootingSubscriptionDrift,
  shouldResetIdleProvisioningSubscription,
  shouldSkipDeadInstanceDestroyDuringBoot,
  shouldDestroyStaleBootMachine,
  isStaleProvisioningBoot,
  isStaleProvisioningClaim,
  shouldCleanupLeakedBootMachine,
  shouldRetryProvisioningForBoot,
  PROVISIONING_BOOT_MAX_MS,
  STALE_PROVISIONING_CLAIM_MS,
} from './machines-provisioning-sync.js';

const NOW = new Date('2026-07-03T12:00:00.000Z').getTime();
const RECENT = new Date(NOW - 2 * 60 * 1000).toISOString();
const OLD = new Date(NOW - 20 * 60 * 1000).toISOString();

describe('machines provisioning sync (boot race)', () => {
  it('keeps fresh provisioning without machine row (async Vast rent)', () => {
    assert.equal(shouldResetIdleProvisioningSubscription(null, 'provisioning'), false);
    assert.equal(shouldResetIdleProvisioningSubscription(null, 'offline'), false);
  });

  it('isStaleProvisioningClaim gates reclaim window', () => {
    assert.equal(isStaleProvisioningClaim({ provisioning_started_at: RECENT }, NOW), false);
    assert.equal(
      isStaleProvisioningClaim(
        {
          provisioning_started_at: new Date(NOW - STALE_PROVISIONING_CLAIM_MS - 1000).toISOString(),
        },
        NOW,
      ),
      true,
    );
  });

  it('isStaleProvisioningBoot uses created_at (not updated_at bumps)', () => {
    const oldCreated = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    const freshUpdated = new Date().toISOString();
    const machine = { status: 'starting', created_at: oldCreated, updated_at: freshUpdated };
    assert.equal(isStaleProvisioningBoot(machine), true);
  });

  it('shouldCleanupLeakedBootMachine when subscription offline with stale booting machine', () => {
    const stale = {
      status: 'starting',
      instance_id: '123',
      created_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    };
    assert.equal(shouldCleanupLeakedBootMachine(stale, 'offline'), true);
    assert.equal(shouldCleanupLeakedBootMachine(stale, 'provisioning'), false);
  });

  it('shouldCleanupLeakedBootMachine only clears long provisioning boot after 30 min', () => {
    const midBoot = {
      status: 'starting',
      instance_id: '123',
      created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    };
    const expiredBoot = {
      status: 'starting',
      instance_id: '123',
      created_at: new Date(Date.now() - (PROVISIONING_BOOT_MAX_MS + 60 * 1000)).toISOString(),
    };
    assert.equal(shouldCleanupLeakedBootMachine(midBoot, 'provisioning'), false);
    assert.equal(shouldCleanupLeakedBootMachine(expiredBoot, 'provisioning'), true);
  });

  it('shouldRetryProvisioningForBoot when machine template differs from target env', () => {
    const machine = {
      status: 'starting',
      instance_id: '123',
      template: 'ComfyUI — Character & Art',
      created_at: new Date().toISOString(),
    };
    assert.equal(
      shouldRetryProvisioningForBoot(machine, { status: 'starting' }, 'ComfyUI — Video AI'),
      true,
    );
    assert.equal(
      shouldRetryProvisioningForBoot(machine, { status: 'starting' }, 'ComfyUI — Character & Art'),
      false,
    );
  });

  it('shouldCleanupLeakedBootMachine keeps fresh boot under offline subscription (start race)', () => {
    const fresh = {
      status: 'starting',
      instance_id: '123',
      created_at: new Date().toISOString(),
    };
    assert.equal(shouldCleanupLeakedBootMachine(fresh, 'offline'), false);
    assert.equal(shouldCleanupLeakedBootMachine(fresh, 'provisioning'), false);
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

  it('does not destroy stale boot while Comfy is still starting', () => {
    assert.equal(shouldDestroyStaleBootMachine({ status: 'starting' }), false);
    assert.equal(shouldDestroyStaleBootMachine({ status: 'creating' }), false);
    assert.equal(shouldDestroyStaleBootMachine({ status: 'disconnected' }), false);
  });

  it('destroys stale boot only on provider error', () => {
    assert.equal(shouldDestroyStaleBootMachine({ status: 'error' }), true);
    assert.equal(shouldDestroyStaleBootMachine({ status: 'running' }), false);
  });
});
