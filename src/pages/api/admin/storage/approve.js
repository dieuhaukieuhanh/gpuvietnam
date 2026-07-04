import { requireAdmin } from '@/lib/admin-auth';
import { applyUserStoragePlan } from '@/lib/storage-plans';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireAdmin(req, res))) return;

  try {
    const { upgradeId } = req.body ?? {};
    if (!upgradeId) {
      return res.status(400).json({ error: 'Thiếu upgradeId.' });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: upgrade, error: fetchError } = await supabaseAdmin
      .from('storage_upgrades')
      .select('*')
      .eq('id', upgradeId)
      .eq('status', 'pending')
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!upgrade) {
      return res.status(404).json({ error: 'Không tìm thấy yêu cầu pending.' });
    }

    await applyUserStoragePlan(
      supabaseAdmin,
      upgrade.user_id,
      upgrade.requested_ssd_gb,
      upgrade.requested_backup_gb,
    );

    const { data, error } = await supabaseAdmin
      .from('storage_upgrades')
      .update({
        payment_status: 'paid',
        status: 'completed',
      })
      .eq('id', upgradeId)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      upgrade: data,
      message: 'Đã duyệt và cập nhật gói bộ nhớ cho khách hàng.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Duyệt thất bại.' });
  }
}
