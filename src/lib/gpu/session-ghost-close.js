/**
 * Close billable gpu_sessions left `running` after the machine is already destroyed.
 * Prevents dashboard/start from thinking a session is still live (blocks "Mở máy").
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

  let query = supabaseAdmin
    .from('gpu_sessions')
    .select('id, machine_id, started_at, status')
    .eq('user_id', uid)
    .eq('status', 'running')
    .not('started_at', 'is', null);

  const machineId = opts.machineId != null ? String(opts.machineId).trim() : '';
  if (machineId) query = query.eq('machine_id', machineId);

  const { data: rows, error } = await query.limit(20);
  if (error) throw error;
  if (!rows?.length) return { closedIds: [] };

  const now = new Date().toISOString();
  /** @type {string[]} */
  const closedIds = [];

  for (const row of rows) {
    const mid = row.machine_id != null ? String(row.machine_id) : '';
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
      .eq('status', 'running')
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
