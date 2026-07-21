import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  claimSubscriptionForProvision,
  reclaimStaleProvisionClaim,
  buildProvisionAttemptLabel,
} from './machines-provision-claim.js';
import { isStaleProvisioningClaim, STALE_PROVISIONING_CLAIM_MS } from './machines-provisioning-sync.js';

function mockSupabase(handler) {
  return {
    from(table) {
      assert.equal(table, 'subscriptions');
      const state = { filters: [], patch: null, selectCols: null };
      const builder = {
        update(patch) {
          state.patch = patch;
          return builder;
        },
        eq(col, val) {
          state.filters.push(['eq', col, val]);
          return builder;
        },
        lt(col, val) {
          state.filters.push(['lt', col, val]);
          return builder;
        },
        is(col, val) {
          state.filters.push(['is', col, val]);
          return builder;
        },
        select(cols) {
          state.selectCols = cols;
          return builder;
        },
        async maybeSingle() {
          return handler(state);
        },
      };
      return builder;
    },
  };
}

describe('buildProvisionAttemptLabel', () => {
  it('builds stable unique-ish label from ids', () => {
    const label = buildProvisionAttemptLabel({
      userId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      correlationId: 'zzzzzzzz-yyyy-xxxx-wwww-vvvvvvvvvvvv',
    });
    assert.equal(label, 'gv-aaaaaaaa-11111111-zzzzzzzz');
    assert.ok(label.length <= 64);
  });
});

describe('isStaleProvisioningClaim', () => {
  it('false when missing or fresh', () => {
    const now = Date.now();
    assert.equal(isStaleProvisioningClaim(null, now), false);
    assert.equal(isStaleProvisioningClaim({ provisioning_started_at: null }, now), false);
    assert.equal(
      isStaleProvisioningClaim(
        { provisioning_started_at: new Date(now - 60_000).toISOString() },
        now,
      ),
      false,
    );
  });

  it('true when lease expired or legacy started_at stale', () => {
    const now = Date.now();
    assert.equal(
      isStaleProvisioningClaim(
        {
          provisioning_lease_expires_at: new Date(now - 1).toISOString(),
          provisioning_heartbeat_at: new Date(now - 1).toISOString(),
          provisioning_started_at: new Date(now - 1).toISOString(),
        },
        now,
      ),
      true,
    );
    assert.equal(
      isStaleProvisioningClaim(
        {
          provisioning_started_at: new Date(now - STALE_PROVISIONING_CLAIM_MS - 1).toISOString(),
        },
        now,
      ),
      true,
    );
  });
});

describe('claimSubscriptionForProvision CAS', () => {
  it('returns row when offline claim wins', async () => {
    const row = { id: 'sub-1', server_status: 'provisioning', provisioning_started_at: 't' };
    const sb = mockSupabase((state) => {
      assert.equal(state.patch.server_status, 'provisioning');
      assert.ok(state.patch.provisioning_started_at);
      assert.ok(state.patch.provisioning_lease_id);
      assert.ok(state.patch.provisioning_lease_expires_at);
      assert.ok(state.patch.provisioning_heartbeat_at);
      assert.ok(state.patch.provisioning_lease_owner);
      assert.deepEqual(state.filters.find((f) => f[1] === 'server_status'), [
        'eq',
        'server_status',
        'offline',
      ]);
      return { data: row, error: null };
    });
    const claimed = await claimSubscriptionForProvision(sb, 'sub-1', { plan: 'Pro' });
    assert.equal(claimed, row);
  });

  it('returns null when race lost', async () => {
    const sb = mockSupabase(() => ({ data: null, error: null }));
    const claimed = await claimSubscriptionForProvision(sb, 'sub-1');
    assert.equal(claimed, null);
  });
});

describe('reclaimStaleProvisionClaim', () => {
  it('requires provisioning + stale started_at', async () => {
    const sb = mockSupabase((state) => {
      assert.deepEqual(state.filters.find((f) => f[1] === 'server_status'), [
        'eq',
        'server_status',
        'provisioning',
      ]);
      const ltCol = state.filters.find((f) => f[0] === 'lt')?.[1];
      assert.ok(ltCol === 'provisioning_lease_expires_at' || ltCol === 'provisioning_started_at');
      return { data: { id: 'sub-1' }, error: null };
    });
    const row = await reclaimStaleProvisionClaim(sb, 'sub-1', {
      staleBeforeIso: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(row?.id, 'sub-1');
  });
});