import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { upgradeId, transferNote } = req.body ?? {};
    if (!upgradeId) {
      return res.status(400).json({ error: 'Thiếu upgradeId.' });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: upgrade, error: upgradeError } = await supabaseAdmin
      .from('storage_upgrades')
      .select('*')
      .eq('id', upgradeId)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (upgradeError) throw upgradeError;
    if (!upgrade) {
      return res.status(404).json({ error: 'Không tìm thấy yêu cầu nâng cấp đang chờ.' });
    }

    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('phone, email')
      .eq('id', user.id)
      .maybeSingle();

    const phone = profile?.phone ?? '09xxxxxxx';
    const defaultNote = `${phone} + Nang cap bo nho SSD${upgrade.requested_ssd_gb} Backup${upgrade.requested_backup_gb}`;
    const note = (transferNote ?? defaultNote).trim();

    const { error: updateError } = await supabaseAdmin
      .from('storage_upgrades')
      .update({
        payment_method: 'transfer',
        payment_status: 'unpaid',
        transfer_note: note,
        status: 'pending',
      })
      .eq('id', upgrade.id);

    if (updateError) throw updateError;

    return res.status(200).json({
      success: true,
      message:
        'Đã ghi nhận yêu cầu chuyển khoản. Admin sẽ duyệt trong 5–10 phút sau khi kiểm tra.',
      transferNote: note,
    });
  } catch (err) {
    console.error('[storage/pay-transfer]', err);
    return res.status(500).json({ error: err.message || 'Ghi nhận chuyển khoản thất bại.' });
  }
}
