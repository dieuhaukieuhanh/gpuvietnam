/**
 * Close billable/open gpu_sessions left after the machine is already destroyed.
 * Prevents dashboard/start from thinking a session is still live (blocks "Mở máy").
 *
 * Safe for keep-open / auto-replace: never closes a session whose machine is still
 * creating|starting|running|error.
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{ machineId?: string | null }} [opts]
 * @returns {Promise<{ closedIds: string[] }>}
 */
export async function closeGhostRunningSessionsForUser(supabaseAdmin, userId, opts = {}) {
  const uid = String(userId ?? '').trim();
  if (!uid) return { closedIds: [] };

  // Billable OPEN ghosts (running + started_at) and pending rows bound to a
  // destroyed machine. Pending with null machine_id is left alone (in-flight start).
  let query = supabaseAdmin
    .from('gpu_sessions')
    .select('id, machine_id, started_at, status')
    .eq('user_id', uid)
    .in('status', ['running', 'pending']);

  const machineId = opts.machineId != null ? String(opts.machineId).trim() : '';
  if (machineId) query = query.eq('machine_id', machineId);

  const { data: rows, error } = await query.limit(20);
  if (error) throw error;
  if (!rows?.length) return { closedIds: [] };

  const now = new Date().toISOString();
  /** @type {string[]} */
  const closedIds = [];

  for (const row of rows) {
    const status = String(row.status ?? '');
    const mid = row.machine_id != null ? String(row.machine_id) : '';

    // In-flight provision: pending with no machine yet — do not close.
    if (status === 'pending' && !mid) continue;

    // Only close billable running rows (started_at set) or pending bound to a dead machine.
    if (status === 'running' && !row.started_at) continue;

    let machineDestroyed = !mid;
    if (mid) {
      const { data: machine, error: mErr } = await supabaseAdmin
        .from('machines')
        .select('id, status')
        .eq('id', mid)
        .maybeSingle();
      if (mErr) throw mErr;
      machineDestroyed = !machine || String(machine.status ?? '') === 'destroyed';
    }
    if (!machineDestroyed) continue;

    const startedMs = row.started_at ? new Date(String(row.started_at)).getTime() : Date.now();
    const durationSeconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));

    const { data: closed, error: cErr } = await supabaseAdmin
      .from('gpu_sessions')
      .update({
        status: 'closed',
        ended_at: now,
        close_requested_at: now,
        verified_destroyed_at: now,
        duration_seconds: durationSeconds,
        destroy_reason: 'ghost_close_destroyed_machine',
        settlement_status: 'skipped',
        settlement_at: now,
      })
      .eq('id', String(row.id))
      .eq('user_id', uid)
      .in('status', ['running', 'pending'])
      .select('id')
      .maybeSingle();
    if (cErr) {
      console.warn('[session-ghost-close] failed', {
        sessionId: row.id,
        message: cErr.message,
      });
      continue;
    }
    if (closed?.id) closedIds.push(String(closed.id));
  }

  if (closedIds.length > 0) {
    console.warn('[session-ghost-close] closed ghost running sessions', {
      userId: uid,
      closedIds,
    });
  }
  return { closedIds };
}
