/** P1 pure helpers (no machines / @ aliases — node:test friendly). */

export const RUNTIME_REPLACE_UX_MESSAGE =
  'Generate tạm gián đoạn — Phiên vẫn làm việc bình thường';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function loadOpenBillableSessionForUser(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('gpu_sessions')
    .select('id, status, started_at, machine_id, plan, billing, template, gpu_config')
    .eq('user_id', userId)
    .eq('status', 'running')
    .not('started_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
