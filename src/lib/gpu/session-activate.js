/**
 * Optimistic-concurrency activate: flip gpu_sessions pending -> running.
 *
 * SCB 3.1 — the DB update is guarded by `status='pending'` (not just `id=?`),
 * so a concurrent transition (close, re-activate, delete) that changed status
 * away from `pending` makes the update affect 0 rows. In that case we return a
 * clear domain result — no retry, no force update. `started_at` is set ONCE
 * here: pending rows have NULL started_at (gpu_sessions_pending_has_no_started_at
 * invariant), and the `status='pending'` guard guarantees we never touch a row
 * that already left pending (and therefore already has started_at set or is
 * terminal). started_at is thus never overwritten.
 *
 * Node-testable: no `@/lib` imports — only the Supabase client passed in.
 */

export const ACTIVATE_OUTCOME = Object.freeze({
  ACTIVATED: 'ACTIVATED',
  ALREADY_RUNNING: 'ALREADY_RUNNING',
  CLOSED: 'CLOSED',
  CONCURRENT_TRANSITION: 'CONCURRENT_TRANSITION',
  ERROR: 'ERROR',
});

const ACTIVATE_SELECT =
  'id, status, started_at, verified_running_at, settlement_status';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} sessionId
 * @param {{
 *   status: string;
 *   started_at: string;
 *   verified_running_at: string;
 *   settlement_status: string | null;
 * }} activated
 * @returns {Promise<{
 *   outcome: string;
 *   session?: Record<string, unknown> | null;
 *   currentStatus?: string | null;
 *   error?: string;
 * }>}
 */
export async function activateSessionRow(supabaseAdmin, sessionId, activated) {
  // Guarded update: only flips a row that is STILL pending. `.select()` returns
  // the updated row so a 0-row result is observable (PostgREST returns null when
  // no row matched the WHERE clause).
  const { data, error } = await supabaseAdmin
    .from('gpu_sessions')
    .update({
      status: activated.status,
      started_at: activated.started_at,
      verified_running_at: activated.verified_running_at,
      settlement_status: activated.settlement_status,
      duration_seconds: 0,
    })
    .eq('id', sessionId)
    .eq('status', 'pending')
    .select(ACTIVATE_SELECT)
    .maybeSingle();

  if (error) {
    return { outcome: ACTIVATE_OUTCOME.ERROR, error: error.message };
  }

  if (data) {
    return { outcome: ACTIVATE_OUTCOME.ACTIVATED, session: data };
  }

  // 0 rows affected → a concurrent transition changed status away from pending.
  // Re-read ONCE to report the actual state. This is observability only — the
  // transition itself is NOT retried and NOT forced.
  const { data: current, error: readError } = await supabaseAdmin
    .from('gpu_sessions')
    .select(ACTIVATE_SELECT)
    .eq('id', sessionId)
    .maybeSingle();

  if (readError) {
    return { outcome: ACTIVATE_OUTCOME.ERROR, error: readError.message };
  }

  const currentStatus = current?.status ?? null;
  if (currentStatus === 'running') {
    return { outcome: ACTIVATE_OUTCOME.ALREADY_RUNNING, session: current };
  }
  if (currentStatus === 'closed') {
    return { outcome: ACTIVATE_OUTCOME.CLOSED, session: current };
  }
  return {
    outcome: ACTIVATE_OUTCOME.CONCURRENT_TRANSITION,
    session: current,
    currentStatus,
  };
}
