import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BACKUP_TOKEN_PREFIX,
  hashBackupToken,
  issueMachineBackupToken,
  revokeBackupTokensForMachine,
  revokeBackupTokensForSubscription,
  verifyMachineBackupToken,
} from './machine-backup-token.js';

function createTokenStore() {
  /** @type {Map<string, Record<string, unknown>>} */
  const byId = new Map();
  /** @type {Map<string, string>} */
  const idByHash = new Map();

  function from() {
    const state = {
      mode: null,
      patch: null,
      filters: /** @type {Array<[string, string, unknown]>} */ ([]),
    };

    const builder = {
      insert(row) {
        state.mode = 'insert';
        state.patch = row;
        return builder;
      },
      update(patch) {
        state.mode = 'update';
        state.patch = patch;
        return builder;
      },
      select() {
        return builder;
      },
      eq(col, val) {
        state.filters.push(['eq', col, val]);
        return builder;
      },
      is(col, val) {
        state.filters.push(['is', col, val]);
        return builder;
      },
      async single() {
        if (state.mode === 'insert') {
          const id = `tok-${byId.size}`;
          const row = {
            id,
            user_id: state.patch.user_id,
            machine_id: state.patch.machine_id ?? null,
            subscription_id: state.patch.subscription_id ?? null,
            token_hash: state.patch.token_hash,
            expires_at: state.patch.expires_at,
            revoked_at: null,
          };
          byId.set(id, row);
          idByHash.set(String(row.token_hash), id);
          return { data: row, error: null };
        }
        return { data: null, error: new Error('single unsupported') };
      },
      async maybeSingle() {
        const hashFilter = state.filters.find((f) => f[0] === 'eq' && f[1] === 'token_hash');
        if (!hashFilter) return { data: null, error: null };
        const id = idByHash.get(String(hashFilter[2]));
        return { data: id ? byId.get(id) : null, error: null };
      },
      then(resolve, reject) {
        try {
          if (state.mode !== 'update') {
            resolve({ data: [], error: null });
            return;
          }
          const machineEq = state.filters.find((f) => f[0] === 'eq' && f[1] === 'machine_id');
          const subEq = state.filters.find((f) => f[0] === 'eq' && f[1] === 'subscription_id');
          const revoked = [];
          for (const row of byId.values()) {
            if (row.revoked_at) continue;
            if (machineEq && String(row.machine_id) !== String(machineEq[2])) continue;
            if (subEq && String(row.subscription_id) !== String(subEq[2])) continue;
            row.revoked_at = state.patch.revoked_at;
            revoked.push({ id: row.id });
          }
          resolve({ data: revoked, error: null });
        } catch (e) {
          reject(e);
        }
      },
    };
    return builder;
  }

  return {
    from(table) {
      assert.equal(table, 'machine_backup_tokens');
      return from();
    },
    _byId: byId,
  };
}

describe('issue/verify/revoke machine backup tokens', () => {
  it('issues token with gvb. prefix and verifies', async () => {
    const sb = createTokenStore();
    const issued = await issueMachineBackupToken(sb, {
      userId: 'user-1',
      machineId: 'm-1',
      subscriptionId: 's-1',
      ttlSeconds: 3600,
    });
    assert.ok(issued.token.startsWith(BACKUP_TOKEN_PREFIX));
    assert.equal(issued.userId, 'user-1');

    const verified = await verifyMachineBackupToken(sb, issued.token);
    assert.ok(verified);
    assert.equal(verified.userId, 'user-1');
    assert.equal(verified.machineId, 'm-1');
  });

  it('rejects forged token and wrong prefix', async () => {
    const sb = createTokenStore();
    assert.equal(await verifyMachineBackupToken(sb, 'not-a-token'), null);
    assert.equal(await verifyMachineBackupToken(sb, `${BACKUP_TOKEN_PREFIX}forged`), null);
  });

  it('rejects expired token', async () => {
    const sb = createTokenStore();
    const issued = await issueMachineBackupToken(sb, { userId: 'u', ttlSeconds: 3600 });
    const row = [...sb._byId.values()][0];
    row.expires_at = new Date(Date.now() - 1000).toISOString();
    assert.equal(await verifyMachineBackupToken(sb, issued.token), null);
  });

  it('rejects revoked token after revokeBackupTokensForMachine', async () => {
    const sb = createTokenStore();
    const issued = await issueMachineBackupToken(sb, {
      userId: 'u',
      machineId: 'm-9',
      ttlSeconds: 3600,
    });
    const rev = await revokeBackupTokensForMachine(sb, 'm-9');
    assert.equal(rev.revoked, 1);
    assert.equal(await verifyMachineBackupToken(sb, issued.token), null);
  });

  it('revokes by subscription', async () => {
    const sb = createTokenStore();
    const issued = await issueMachineBackupToken(sb, {
      userId: 'u',
      subscriptionId: 'sub-2',
      ttlSeconds: 3600,
    });
    const rev = await revokeBackupTokensForSubscription(sb, 'sub-2');
    assert.equal(rev.revoked, 1);
    assert.equal(await verifyMachineBackupToken(sb, issued.token), null);
  });

  it('hash is stable', () => {
    assert.equal(hashBackupToken('gvb.x'), hashBackupToken('gvb.x'));
  });
});
