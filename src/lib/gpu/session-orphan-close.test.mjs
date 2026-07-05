import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { closeOrphanRunningSessionsLifecycle } from './session-orphan-close.js';

/**
 * Thenable-chain mock client.
 *
 * Query shapes used by the helper:
 *   from('gpu_sessions').select(cols).eq('user_id',u).eq('status','running')  -> {data: SessionRow[], error}
 *   from('machines').select('gpu_session_id').eq('user_id',u).in('status',[..]) -> {data: MachineRow[], error}
 *   from('gpu_sessions').update(patch).eq('id',s).eq('status','running').select('id').maybeSingle()
 *                                                                               -> {data: {id}|null, error}
 *
 * @param {{
 *   sessions?: Record<string, unknown>[],
 *   machines?: Record<string, unknown>[],
 *   updateError?: { message: string } | null,
 *   zeroRowIds?: Set<string>,
 * }} cfg
 */
function makeClient(cfg) {
  const tables = [];
  const updates = [];
  const supabaseAdmin = {
    from(table) {
      tables.push(table);
      const state = { table, isUpdate: false, isSelect: false, maybeSingle: false, filters: {}, patch: null };
      const chain = {
        update(patch) { state.isUpdate = true; state.patch = patch; return chain; },
        select(cols) { state.isSelect = true; state.selectCols = cols; return chain; },
        eq(col, val) { state.filters[col] = val; return chain; },
        in(col, vals) { state.filters[col] = vals; return chain; },
        maybeSingle() { state.maybeSingle = true; return chain; },
        then(resolve) {
          if (state.isUpdate) {
            const id = state.filters.id;
            updates.push({ table: state.table, patch: { ...state.patch }, filters: { ...state.filters } });
            const zero = cfg.zeroRowIds && cfg.zeroRowIds.has(String(id));
            resolve({ data: zero ? null : { id }, error: cfg.updateError ?? null });
            return;
          }
          if (state.isSelect) {
            if (state.table === 'gpu_sessions' && state.filters.status === 'running') {
              resolve({ data: cfg.sessions ?? [], error: null });
              return;
            }
            if (state.table === 'machines') {
              resolve({ data: cfg.machines ?? [], error: null });
              return;
            }
            resolve({ data: null, error: null });
            return;
          }
          resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
  return { supabaseAdmin, tables, updates };
}

const NOW = '2026-07-04T20:00:00.000Z';

const orphanRow = (id, machine_id = 'mach_old') => ({
  id,
  user_id: 'u1',
  status: 'running',
  machine_id,
  started_at: '2026-07-04T19:00:00.000Z',
  ended_at: null,
  settlement_status: null,
  destroy_reason: null,
  verified_running_at: '2026-07-04T19:00:05.000Z',
  verified_destroyed_at: null,
  created_at: '2026-07-04T19:00:00.000Z',
});

describe('closeOrphanRunningSessionsLifecycle (SCB 3.2)', () => {
  it('orphan running session becomes closed (lifecycle persist)', async () => {
    const { supabaseAdmin, updates } = makeClient({
      sessions: [orphanRow('sess_orphan')],
      machines: [], // no active machine -> session is orphan
    });

    const res = await closeOrphanRunningSessionsLifecycle(supabaseAdmin, 'u1', { now: NOW });

    assert.equal(res.closed, 1);
    assert.equal(res.skipped, 0);
    assert.deepEqual(res.sessionIds, ['sess_orphan']);

    assert.equal(updates.length, 1, 'exactly one persist update');
    const patch = updates[0].patch;
    assert.equal(patch.status, 'closed', 'lifecycle status set to closed');
    assert.equal(patch.ended_at, NOW);
    assert.equal(patch.verified_destroyed_at, NOW);
    assert.equal(patch.destroy_reason, 'orphan');
    assert.equal(patch.duration_seconds, 0);
    assert.equal(patch.output_summary, 'orphan_auto_closed');

    // Persist guarded by WHERE status='running'.
    assert.equal(updates[0].filters.id, 'sess_orphan');
    assert.equal(updates[0].filters.status, 'running');
  });

  it('next pending session can be created — orphan no longer running', async () => {
    // After the lifecycle close, the row is status='closed' so the per-user
    // unique index (one running session per user) no longer blocks a new
    // pending insert. We assert the persisted status is terminal 'closed'.
    const { supabaseAdmin, updates } = makeClient({
      sessions: [orphanRow('sess_blocker')],
      machines: [],
    });
    await closeOrphanRunningSessionsLifecycle(supabaseAdmin, 'u1', { now: NOW });
    assert.equal(updates[0].patch.status, 'closed');
    assert.notEqual(updates[0].patch.status, 'running');
  });

  it('no settlement invoked — settlement_status stays pending, not settled', async () => {
    const { supabaseAdmin, updates, tables } = makeClient({
      sessions: [orphanRow('sess_o')],
      machines: [],
    });
    await closeOrphanRunningSessionsLifecycle(supabaseAdmin, 'u1', { now: NOW });

    const ss = updates[0].patch.settlement_status;
    assert.equal(ss, 'pending', 'closeSession sets settlement_status=pending (NOT settled/in_progress/skipped/failed)');
    assert.notEqual(ss, 'settled');
    assert.notEqual(ss, 'in_progress');
    assert.notEqual(ss, 'skipped');
    assert.notEqual(ss, 'failed');
    // No settlement table touched.
    assert.ok(!tables.includes('wallet_transactions'));
    assert.ok(!tables.some((t) => t.includes('settlement')));
  });

  it('no billing invoked — patch contains only lifecycle/usage-zero fields', async () => {
    const { supabaseAdmin, updates } = makeClient({
      sessions: [orphanRow('sess_o')],
      machines: [],
    });
    await closeOrphanRunningSessionsLifecycle(supabaseAdmin, 'u1', { now: NOW });

    const patch = updates[0].patch;
    const allowed = new Set([
      'status',
      'ended_at',
      'settlement_status',
      'destroy_reason',
      'verified_destroyed_at',
      'duration_seconds',
      'output_summary',
    ]);
    for (const key of Object.keys(patch)) {
      assert.ok(allowed.has(key), `unexpected billing field in patch: ${key}`);
    }
    // No charge/amount/price/cost keys.
    for (const forbidden of ['amount', 'charge', 'price', 'cost', 'vram_avg_pct', 'output_count']) {
      assert.ok(!(forbidden in patch), `billing field leaked: ${forbidden}`);
    }
  });

  it('no wallet mutation — wallets/wallet_transactions tables never accessed', async () => {
    const { supabaseAdmin, tables } = makeClient({
      sessions: [orphanRow('sess_o')],
      machines: [],
    });
    await closeOrphanRunningSessionsLifecycle(supabaseAdmin, 'u1', { now: NOW });
    assert.ok(!tables.includes('wallets'), 'wallets table must not be touched');
    assert.ok(!tables.includes('wallet_transactions'), 'wallet_transactions table must not be touched');
    assert.deepEqual(
      [...new Set(tables)].sort(),
      ['gpu_sessions', 'machines'],
      'only gpu_sessions + machines may be accessed',
    );
  });

  it('no inventory mutation — inventory tables never accessed', async () => {
    const { supabaseAdmin, tables } = makeClient({
      sessions: [orphanRow('sess_o')],
      machines: [],
    });
    await closeOrphanRunningSessionsLifecycle(supabaseAdmin, 'u1', { now: NOW });
    assert.ok(!tables.includes('user_plan_inventory'), 'user_plan_inventory must not be touched');
    assert.ok(!tables.some((t) => t.includes('inventor')), 'no inventory table may be touched');
  });

  it('session linked to an active machine is NOT closed (not orphan)', async () => {
    const { supabaseAdmin, updates } = makeClient({
      sessions: [orphanRow('sess_linked')],
      machines: [{ gpu_session_id: 'sess_linked' }], // active machine links it
    });
    const res = await closeOrphanRunningSessionsLifecycle(supabaseAdmin, 'u1', { now: NOW });
    assert.equal(res.closed, 0, 'linked session must not be closed');
    assert.equal(updates.length, 0, 'no persist update for linked session');
  });

  it('concurrent close (0-row persist) -> skipped, not retried, not forced', async () => {
    const { supabaseAdmin, updates } = makeClient({
      sessions: [orphanRow('sess_o')],
      machines: [],
      zeroRowIds: new Set(['sess_o']), // reconciliation already closed it
    });
    const res = await closeOrphanRunningSessionsLifecycle(supabaseAdmin, 'u1', { now: NOW });
    assert.equal(res.closed, 0, 'must not count a concurrent close as ours');
    assert.equal(res.skipped, 1);
    assert.equal(updates.length, 1, 'exactly one update attempt — no retry, no force');
  });

  it('multiple orphans all closed in one pass', async () => {
    const { supabaseAdmin, updates } = makeClient({
      sessions: [orphanRow('sess_a'), orphanRow('sess_b'), orphanRow('sess_c')],
      machines: [],
    });
    const res = await closeOrphanRunningSessionsLifecycle(supabaseAdmin, 'u1', { now: NOW });
    assert.equal(res.closed, 3);
    assert.deepEqual(res.sessionIds, ['sess_a', 'sess_b', 'sess_c']);
    assert.equal(updates.length, 3);
  });
});
