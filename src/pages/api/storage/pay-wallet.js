import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { applyUserStoragePlan } from '@/lib/storage-plans';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { upgradeId } = req.body ?? {};
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

    const totalAmount = Number(upgrade.total_amount);
    if (totalAmount <= 0) {
      return res.status(400).json({ error: 'Yêu cầu này không cần thanh toán.' });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('wallet_balance')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    const walletBalance = Number(profile?.wallet_balance ?? 0);
    if (walletBalance < totalAmount) {
      return res.status(400).json({
        error: `Số dư ví không đủ. Cần ${totalAmount.toLocaleString('vi-VN')}đ, hiện có ${walletBalance.toLocaleString('vi-VN')}đ.`,
        code: 'insufficient_balance',
      });
    }

    const newBalance = walletBalance - totalAmount;

    const { error: walletError } = await supabaseAdmin
      .from('users')
      .update({ wallet_balance: newBalance, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (walletError) throw walletError;

    await applyUserStoragePlan(
      supabaseAdmin,
      user.id,
      upgrade.requested_ssd_gb,
      upgrade.requested_backup_gb,
    );

    const { error: updateError } = await supabaseAdmin
      .from('storage_upgrades')
      .update({
        payment_method: 'wallet',
        payment_status: 'paid',
        status: 'completed',
      })
      .eq('id', upgrade.id);

    if (updateError) throw updateError;

    return res.status(200).json({
      success: true,
      walletBalance: newBalance,
      ssdPlanGb: upgrade.requested_ssd_gb,
      backupPlanGb: upgrade.requested_backup_gb,
      message: 'Thanh toán ví thành công. Gói bộ nhớ đã được cập nhật.',
    });
  } catch (err) {
    console.error('[storage/pay-wallet]', err);
    return res.status(500).json({ error: err.message || 'Thanh toán ví thất bại.' });
  }
}
