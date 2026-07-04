import { requireAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireAdmin(req, res))) return;

  try {
    const { upgradeId, reason } = req.body ?? {};
    if (!upgradeId) {
      return res.status(400).json({ error: 'Thiếu upgradeId.' });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data, error } = await supabaseAdmin
      .from('storage_upgrades')
      .update({
        status: 'rejected',
        admin_note: reason?.trim() || 'Admin từ chối yêu cầu nâng cấp bộ nhớ.',
      })
      .eq('id', upgradeId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Không tìm thấy yêu cầu pending.' });
    }

    return res.status(200).json({
      success: true,
      upgrade: data,
      message: 'Đã từ chối yêu cầu nâng cấp bộ nhớ.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Từ chối thất bại.' });
  }
}
