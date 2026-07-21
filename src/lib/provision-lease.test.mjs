import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  buildProvisionLeasePatch,
  computeLeaseExpiresAt,
  isProvisionLeaseExpired,
  remainingLeaseMs,
  clearedProvisionLeaseFields,
} from './provision-lease.js';
import {
  PROVISION_LEASE_MS,
  PROVISION_MAX_IDLE_MS,
  LEGACY_STALE_PROVISIONING_CLAIM_MS,
} from './provision-lease-config.js';
import {
  getProvisionLeaseMetrics,
  incrProvisionLeaseMetric,
  resetProvisionLeaseMetrics,
  recordLeaseDurationMs,
} from './provision-lease-metrics.js';
import { isStaleProvisioningClaim, STALE_PROVISIONING_CLAIM_MS } from './machines-provisioning-sync.js';

describe('provision lease expiry', () => {
  it('keeps active lease alive', () => {
    const now = Date.now();
    const sub = {
      provisioning_lease_id: 'l1',
      provisioning_lease_expires_at: new Date(now + 60_000).toISOString(),
      provisioning_heartbeat_at: new Date(now - 10_000).toISOString(),
      provisioning_started_at: new Date(now - 120_000).toISOString(),
    };
    assert.equal(isProvisionLeaseExpired(sub, now), false);
    assert.equal(isStaleProvisioningClaim(sub, now), false);
    assert.ok(remainingLeaseMs(sub, now) > 50_000);
  });

  it('expires when lease_expires_at passed', () => {
    const now = Date.now();
    const sub = {
      provisioning_lease_expires_at: new Date(now - 1000).toISOString(),
      provisioning_heartbeat_at: new Date(now - 1000).toISOString(),
      provisioning_started_at: new Date(now - 1000).toISOString(),
    };
    assert.equal(isProvisionLeaseExpired(sub, now), true);
  });

  it('expires when heartbeat idle exceeds max idle', () => {
    const now = Date.now();
    const sub = {
      provisioning_lease_expires_at: new Date(now + 60_000).toISOString(),
      provisioning_heartbeat_at: new Date(now - PROVISION_MAX_IDLE_MS - 1).toISOString(),
      provisioning_started_at: new Date(now - 200_000).toISOString(),
    };
    assert.equal(isProvisionLeaseExpired(sub, now), true);
  });

  it('legacy fallback uses started_at when lease columns null', () => {
    const now = Date.now();
    assert.equal(
      isProvisionLeaseExpired(
        { provisioning_started_at: new Date(now - 60_000).toISOString() },
        now,
      ),
      false,
    );
    assert.equal(
      isProvisionLeaseExpired(
        {
          provisioning_started_at: new Date(
            now - LEGACY_STALE_PROVISIONING_CLAIM_MS - 1,
          ).toISOString(),
        },
        now,
      ),
      true,
    );
    assert.equal(STALE_PROVISIONING_CLAIM_MS, LEGACY_STALE_PROVISIONING_CLAIM_MS);
  });
});

describe('buildProvisionLeasePatch', () => {
  it('sets lease id, owner, expires, heartbeat', () => {
    const { patch, leaseId, ownerId } = buildProvisionLeasePatch({
      nowIso: '2026-07-11T00:00:00.000Z',
      leaseMs: 90_000,
      plan: 'Pro',
    });
    assert.equal(patch.server_status, 'provisioning');
    assert.equal(patch.provisioning_lease_id, leaseId);
    assert.equal(patch.provisioning_lease_owner, ownerId);
    assert.equal(patch.provisioning_started_at, '2026-07-11T00:00:00.000Z');
    assert.equal(patch.provisioning_heartbeat_at, '2026-07-11T00:00:00.000Z');
    assert.ok(String(patch.provisioning_lease_expires_at).startsWith('2026-07-11T00:01:30'));
    assert.equal(patch.plan, 'Pro');
    assert.deepEqual(Object.keys(clearedProvisionLeaseFields()).sort(), [
      'provisioning_heartbeat_at',
      'provisioning_lease_expires_at',
      'provisioning_lease_id',
      'provisioning_lease_owner',
      'provisioning_started_at',
    ]);
  });

  it('computeLeaseExpiresAt respects lease ms', () => {
    const at = computeLeaseExpiresAt(90_000, Date.parse('2026-07-11T00:00:00.000Z'));
    assert.equal(at, '2026-07-11T00:01:30.000Z');
    assert.equal(PROVISION_LEASE_MS > 0, true);
  });
});

describe('provision lease metrics', () => {
  beforeEach(() => resetProvisionLeaseMetrics());

  it('tracks counters and average duration', () => {
    incrProvisionLeaseMetric('leaseCreated');
    incrProvisionLeaseMetric('leaseHeartbeat', 2);
    recordLeaseDurationMs(1000);
    recordLeaseDurationMs(3000);
    const snap = getProvisionLeaseMetrics();
    assert.equal(snap.leaseCreated, 1);
    assert.equal(snap.leaseHeartbeat, 2);
    assert.equal(snap.averageLeaseDuration, 2000);
  });
});
