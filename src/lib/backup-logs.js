/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   userId: string;
 *   machineId?: string | null;
 *   reason: string;
 *   status: 'completed' | 'failed' | 'partial';
 *   errorMessage?: string | null;
 *   sizeBytes?: number;
 *   archives?: Array<Record<string, unknown>>;
 * }} payload
 */
export async function createBackupLog(supabaseAdmin, payload) {
  const { data, error } = await supabaseAdmin
    .from('backup_logs')
    .insert({
      user_id: payload.userId,
      machine_id: payload.machineId ?? null,
      reason: payload.reason,
      status: payload.status,
      error_message: payload.errorMessage ?? null,
      size_bytes: payload.sizeBytes ?? 0,
      archives: payload.archives ?? [],
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{ limit?: number }} [options]
 */
export async function listRecentBackupLogs(supabaseAdmin, userId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 5, 1), 20);

  const { data, error } = await supabaseAdmin
    .from('backup_logs')
    .select('id, user_id, machine_id, reason, status, error_message, size_bytes, archives, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {number | string} logId
 */
export async function getBackupLogForUser(supabaseAdmin, userId, logId) {
  const { data, error } = await supabaseAdmin
    .from('backup_logs')
    .select('*')
    .eq('id', logId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export const BACKUP_REASON_LABELS = {
  idle_timeout: 'Tự động tắt (không sử dụng)',
  out_of_credit: 'Hết giờ / hết tiền',
  user_stop: 'Tắt máy thủ công',
  admin_stop: 'Admin tắt máy',
  manual_stop: 'Tắt máy thủ công',
};
