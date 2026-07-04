import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activateSessionRow,
  ACTIVATE_OUTCOME,
} from './session-activate.js';

/**
 * Fluent mock client. The update branch (when `.update()` is called) returns
 * `updatedRow`/`error` from `.maybeSingle()`; the read-only select branch
 * returns `currentRow`. This mirrors the real PostgREST contract where a
 * guarded `.update().select()` returns the affected row, or null when 0 rows
 * matched the WHERE clause.
 *
 * @param {{
 *   updatedRow?: Record<string, unknown> | null;
 *   currentRow?: Record<string, unknown> | null;
 *   error?: { message: string } | null;
 * }} cfg
 */
function makeClient(cfg) {
  const calls = [];
  const supabaseAdmin = {
    from(table) {
      let isUpdate = false;
      const chain = {
        update(patch) {
          isUpdate = true;
          calls.push({ kind: 'update', table, patch });
          return chain;
        },
        select(cols) {
          calls.push({ kind: 'select', table, cols });
          return chain;
        },
        eq(col, val) {
          calls.push({ kind: 'eq', col, val });
          return chain;
        },
        maybeSingle() {
          if (isUpdate) {
            return Promise.resolve({ data: cfg.updatedRow ?? null, error: cfg.error ?? null });
          }
          return Promise.resolve({ data: cfg.currentRow ?? null, error: null });
        },
      };
      return chain;
    },
  };
  return { supabaseAdmin, calls };
}

const ACTIVATED_PATCH = {
  status: 'running',
  started_at: '2026-07-04T10:00:00Z',
  verified_running_at: '2026-07-04T10:00:05Z',
  settlement_status: null,
};

const RUNNING_ROW = {
  id: 'sess_1',
  status: 'running',
  started_at: '2026-07-04T10:00:00Z',
  verified_running_at: '2026-07-04T10:00:05Z',
  settlement_status: null,
};

const CLOSED_ROW = {
  id: 'sess_1',
  status: 'closed',
  started_at: '2026-07-04T10:00:00Z',
  verified_running_at: '2026-07-04T10:00:05Z',
  settlement_status: 'settled',
};

describe('activateSessionRow (SCB 3.1 optimistic concurrency)', () => {
  it('activate success: row still pending -> ACTIVATED', async () => {
    const { supabaseAdmin, calls } = makeClient({ updatedRow: RUNNING_ROW });
    const res = await activateSessionRow(supabaseAdmin, 'sess_1', ACTIVATED_PATCH);

    assert.equal(res.outcome, ACTIVATE_OUTCOME.ACTIVATED);
    assert.equal(res.session, RUNNING_ROW);
    assert.equal(res.error, undefined);

    // Guard present: WHERE id AND status='pending'
    const eqs = calls.filter((c) => c.kind === 'eq');
    assert.deepEqual(
      eqs.map((c) => `${c.col}=${c.val}`),
      ['id=sess_1', 'status=pending'],
      'update must be guarded by WHERE status=pending',
    );

    // Patch writes started_at exactly once (set, not overwrite) — and ONLY when
    // the row matched the pending guard.
    const upd = calls.find((c) => c.kind === 'update');
    assert.equal(upd.patch.started_at, ACTIVATED_PATCH.started_at);

    // No re-read occurred on the success path.
    const selects = calls.filter((c) => c.kind === 'select');
    assert.equal(selects.length, 1, 'success path must not re-read the row');
  });

  it('double activate: row already running -> ALREADY_RUNNING (no retry/force)', async () => {
    // Guarded update matches 0 rows (status is now 'running', not 'pending').
    const { supabaseAdmin, calls } = makeClient({
      updatedRow: null,
      currentRow: RUNNING_ROW,
    });
    const res = await activateSessionRow(supabaseAdmin, 'sess_1', ACTIVATED_PATCH);

    assert.equal(res.outcome, ACTIVATE_OUTCOME.ALREADY_RUNNING);
    assert.equal(res.session, RUNNING_ROW);

    // Exactly ONE update attempt — no retry, no force update.
    const updates = calls.filter((c) => c.kind === 'update');
    assert.equal(updates.length, 1, 'must not retry the activate update');
  });

  it('activate after closed: row already closed -> CLOSED (no started_at overwrite)', async () => {
    const { supabaseAdmin, calls } = makeClient({
      updatedRow: null,
      currentRow: CLOSED_ROW,
    });
    const res = await activateSessionRow(supabaseAdmin, 'sess_1', ACTIVATED_PATCH);

    assert.equal(res.outcome, ACTIVATE_OUTCOME.CLOSED);
    assert.equal(res.session, CLOSED_ROW);

    // The guarded update wrote 0 rows, so started_at on the closed row was
    // never touched.
    const upd = calls.find((c) => c.kind === 'update');
    assert.ok(upd, 'one update attempt was made');
    const eqs = calls.filter((c) => c.kind === 'eq');
    assert.ok(
      eqs.some((c) => c.col === 'status' && c.val === 'pending'),
      'guard must be present even on the closed path',
    );
  });

  it('race -> update affects 0 rows and row vanished -> CONCURRENT_TRANSITION', async () => {
    // Concurrent flow deleted the row: guarded update 0 rows, re-read finds null.
    const { supabaseAdmin } = makeClient({ updatedRow: null, currentRow: null });
    const res = await activateSessionRow(supabaseAdmin, 'sess_1', ACTIVATED_PATCH);

    assert.equal(res.outcome, ACTIVATE_OUTCOME.CONCURRENT_TRANSITION);
    assert.equal(res.session, null);
    assert.equal(res.currentStatus, null);
  });

  it('update error -> ERROR (no retry)', async () => {
    const { supabaseAdmin, calls } = makeClient({
      updatedRow: null,
      error: { message: 'rls denied' },
    });
    const res = await activateSessionRow(supabaseAdmin, 'sess_1', ACTIVATED_PATCH);

    assert.equal(res.outcome, ACTIVATE_OUTCOME.ERROR);
    assert.equal(res.error, 'rls denied');
    const updates = calls.filter((c) => c.kind === 'update');
    assert.equal(updates.length, 1, 'must not retry on error');
  });
});
