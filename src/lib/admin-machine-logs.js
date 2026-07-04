/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   adminId?: string | null;
 *   userId: string;
 *   action: 'start' | 'stop';
 *   machineId?: string | null;
 *   reason?: string | null;
 * }} payload
 */
export async function insertAdminMachineLog(supabaseAdmin, payload) {
  const { adminId = null, userId, action, machineId = null, reason = null } = payload;

  const { data, error } = await supabaseAdmin
    .from('admin_machine_logs')
    .insert({
      admin_id: adminId,
      user_id: userId,
      action,
      machine_id: machineId,
      reason,
    })
    .select('id, admin_id, user_id, action, machine_id, reason, created_at')
    .single();

  if (error) {
    console.warn('[admin-machine-logs] insert failed:', error.message);
    return null;
  }

  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {number} [limit]
 */
export async function fetchRecentAdminMachineLogs(supabaseAdmin, userId, limit = 3) {
  const { data, error } = await supabaseAdmin
    .from('admin_machine_logs')
    .select('id, admin_id, user_id, action, machine_id, reason, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[admin-machine-logs] fetch failed:', error.message);
    return [];
  }

  return data ?? [];
}
