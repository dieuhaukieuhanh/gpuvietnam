import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { closeOrphanRunningSessionsLifecycle } from './session-orphan-close.js';

/**
 * Thenable-chain mock client.
 *
 * Query shapes used by the helper:
 *   from('gpu_sessions').select(cols).eq('user_id',u).eq('status','running')  -> {data: SessionRow[], error}
 *   from('machines').select('id, gpu_session_id').eq('user_id',u).in('status',[..]) -> {data: MachineRow[], error}
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
  it('P0-B — billable OPEN session is never orphan-closed (even with no active machine)', async () => {
    const { supabaseAdmin, updates } = makeClient({
      sessions: [orphanRow('sess_billable')],
      machines: [],
    });

    const res = await closeOrphanRunningSessionsLifecycle(supabaseAdmin, 'u1', { now: NOW });

    assert.equal(res.closed, 0);
    assert.equal(res.skipped, 1);
    assert.equal(updates.length, 0);
  });

  it('P0-B — machine status=error still binds the session (Runtime DEAD keep-open)', async () => {
    const { supabaseAdmin, updates } = makeClient({
      sessions: [orphanRow('sess_error', 'mach_err')],
      machines: [{ id: 'mach_err', gpu_session_id: 'sess_error' }],
    });
    // machines query filters by status list including error — mock returns linked row
    const res = await closeOrphanRunningSessionsLifecycle(supabaseAdmin, 'u1', { now: NOW });
    assert.equal(res.closed, 0);
    assert.equal(updates.length, 0);
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

  it('session with NULL projection gpu_session_id but FK machine_id on active machine is NOT orphan', async () => {
    const { supabaseAdmin, updates } = makeClient({
      sessions: [orphanRow('sess_live', 'mach_live')],
      machines: [{ id: 'mach_live', gpu_session_id: null }],
    });
    const res = await closeOrphanRunningSessionsLifecycle(supabaseAdmin, 'u1', { now: NOW });
    assert.equal(res.closed, 0, 'FK-linked live session must not be closed as orphan');
    assert.equal(updates.length, 0);
  });

  it('multiple billable sessions without machines are kept open (not mass-closed)', async () => {
    const { supabaseAdmin, updates } = makeClient({
      sessions: [orphanRow('sess_a'), orphanRow('sess_b'), orphanRow('sess_c')],
      machines: [],
    });
    const res = await closeOrphanRunningSessionsLifecycle(supabaseAdmin, 'u1', { now: NOW });
    assert.equal(res.closed, 0);
    assert.equal(res.skipped, 3);
    assert.equal(updates.length, 0);
  });
});
