/**
 * SCB 3.2 — Orphan running session close (synchronous runtime path).
 *
 * Fixes the M4 regression: `billing.closeOrphanRunningSessions` no longer
 * closes lifecycle state (it only writes usage fields), so an orphan running
 * session stays `status='running'` and blocks the per-user unique index until
 * reconciliation cron runs. This helper performs a *lifecycle* close using the
 * `session-lifecycle.js` state machine (`running -> closed`) and persists only
 * the lifecycle fields.
 *
 * Strictly forbidden here (per Task 2 scope):
 *   - settlement invocation / `finalizeGpuSession`
 *   - wallet mutation
 *   - inventory mutation
 *   - billing formulas
 *   - reconciliation invocation / RPC / transaction / retry
 *
 * The close mirrors the canonical reconciliation pattern (reconciliation.js):
 *   closeSession(record, { providerDestroyedVerified: true, now },
 *                { ended_at, verified_destroyed_at, destroyReason: 'orphan' })
 * The orphan's provider instance is gone, so provider-destroyed is treated as
 * verified — identical semantics to `repairOrphanSession` in reconciliation.
 *
 * Node-testable: only relative imports, no `@/lib` alias.
 */

import {
  closeSession,
  SESSION_STATUS,
} from './session-lifecycle.js';

/**
 * Machine statuses that still bind an open Billing Session.
 * Include `error` — P0-B/P1 Runtime DEAD marks the row error while session stays OPEN
 * (auto-replace). Treating error as unbound incorrectly orphan-closes the session.
 */
const ACTIVE_MACHINE_STATUSES = ['creating', 'starting', 'running', 'error'];

const ORPHAN_SELECT =
  'id, user_id, status, machine_id, started_at, ended_at, settlement_status, destroy_reason, verified_running_at, verified_destroyed_at, created_at';

/**
 * Map a Supabase row to the SessionRecord shape consumed by the state machine.
 * @param {Record<string, unknown>} row
 */
function mapRowToRecord(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    status: row.status,
    machineId: row.machine_id != null ? String(row.machine_id) : null,
    started_at: row.started_at ?? null,
    ended_at: row.ended_at ?? null,
    settlement_status: row.settlement_status ?? null,
    destroy_reason: row.destroy_reason ?? null,
    verified_running_at: row.verified_running_at ?? null,
    verified_destroyed_at: row.verified_destroyed_at ?? null,
    created_at: row.created_at ?? null,
  };
}

/**
 * Detect and lifecycle-close orphan `running` gpu_sessions for a user.
 *
 * An orphan is a `gpu_sessions` row with `status='running'` that is NOT linked
 * to any active machine (`machines.status` in creating|starting|running), by
 * either:
 *   - `machines.gpu_session_id` === session.id, or
 *   - `gpu_sessions.machine_id` === an active machine's id
 * (projection `gpu_session_id` can drift NULL while the FK `machine_id` still
 * points at a live machine — closing that row as orphan resets billing).
 *
 * For each orphan: run `closeSession()` (running -> closed) and persist ONLY
 * lifecycle fields. No settlement, no billing, no wallet, no inventory.
 *
 * The persist update is guarded by `WHERE status='running'` so a concurrent
 * close (e.g. reconciliation cron) makes that row's update affect 0 rows — we
 * count it as already closed and move on. No retry.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{ now?: string }} [deps]
 * @returns {Promise<{ closed: number, skipped: number, sessionIds: string[] }>}
 */
export async function closeOrphanRunningSessionsLifecycle(supabaseAdmin, userId, deps = {}) {
  const now = deps.now ?? new Date().toISOString();

  const [{ data: runningSessions, error: sErr }, { data: activeMachines, error: mErr }] = await Promise.all([
    supabaseAdmin
      .from('gpu_sessions')
      .select(ORPHAN_SELECT)
      .eq('user_id', userId)
      .eq('status', SESSION_STATUS.RUNNING),
    supabaseAdmin
      .from('machines')
      .select('id, gpu_session_id')
      .eq('user_id', userId)
      .in('status', ACTIVE_MACHINE_STATUSES),
  ]);

  if (sErr) throw sErr;
  if (mErr) throw mErr;

  const linkedSessionIds = new Set(
    (activeMachines ?? [])
      .map((row) => (row.gpu_session_id ? String(row.gpu_session_id) : null))
      .filter(Boolean),
  );
  const activeMachineIds = new Set(
    (activeMachines ?? [])
      .map((row) => (row.id != null ? String(row.id) : null))
      .filter(Boolean),
  );

  let closed = 0;
  let skipped = 0;
  const sessionIds = [];

  for (const row of runningSessions ?? []) {
    const sessionId = String(row.id);
    if (linkedSessionIds.has(sessionId)) continue; // has an active machine — not orphan
    const sessionMachineId = row.machine_id != null ? String(row.machine_id) : null;
    // Projection gpu_session_id may be NULL while FK machine_id still points at
    // a live machine — do not treat that as orphan (would reset billing clock).
    if (sessionMachineId && activeMachineIds.has(sessionMachineId)) continue;

    // P0-B / P1: Runtime DEAD keep-open — never lifecycle-close a billable OPEN session.
    // (Machine may be status=error during auto-replace; that is not an orphan.)
    if (row.started_at) {
      skipped += 1;
      continue;
    }

    const record = mapRowToRecord(row);

    // Lifecycle close via the state machine. The orphan's provider instance is
    // gone, so providerDestroyedVerified=true (same as reconciliation repair).
    const closeResult = closeSession(
      record,
      { providerDestroyedVerified: true, now },
      {
        ended_at: now,
        verified_destroyed_at: now,
        destroyReason: 'orphan',
      },
    );

    if (closeResult.state === 'IGNORED') {
      // Already closed (e.g. concurrent transition). Skip.
      skipped += 1;
      continue;
    }
    if (closeResult.state !== 'OK') {
      // State machine rejected the transition — do NOT force. Skip and let
      // reconciliation handle it later. We must never force-update lifecycle.
      skipped += 1;
      continue;
    }

    // Persist ONLY lifecycle fields. Guarded by status='running' so a concurrent
    // close (reconciliation) makes this no-op rather than overwriting. The
    // `.select().maybeSingle()` makes the 0-row result observable so we don't
    // miscount a concurrent close as our own.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('gpu_sessions')
      .update({
        status: closeResult.session.status,
        ended_at: closeResult.session.ended_at,
        settlement_status: closeResult.session.settlement_status,
        destroy_reason: closeResult.session.destroy_reason,
        verified_destroyed_at: closeResult.session.verified_destroyed_at,
        duration_seconds: 0,
        output_summary: 'orphan_auto_closed',
      })
      .eq('id', sessionId)
      .eq('status', SESSION_STATUS.RUNNING)
      .select('id')
      .maybeSingle();

    if (updateError) {
      // Non-fatal: do not block session start. Reconciliation will repair.
      skipped += 1;
      continue;
    }
    if (!updated) {
      // 0 rows affected → a concurrent flow (reconciliation) already closed it.
      // Not our close; do not count, do not retry.
      skipped += 1;
      continue;
    }

    closed += 1;
    sessionIds.push(sessionId);
  }

  return { closed, skipped, sessionIds };
}
