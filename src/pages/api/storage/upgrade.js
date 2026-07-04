import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import {
  applyUserStoragePlan,
  calcStoragePricingFromMaps,
  getStoragePricingMaps,
  getUserStorageUsage,
  isValidPlanGb,
  validateStorageDowngrade,
} from '@/lib/storage-plans';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const user = await getAuthUserFromRequest(req);
      if (!user) return unauthorized(res);

      const upgradeId = req.query.id;
      if (!upgradeId || typeof upgradeId !== 'string') {
        return res.status(400).json({ error: 'Thiếu id.' });
      }

      const supabaseAdmin = getSupabaseAdmin();
      const { data: upgrade, error } = await supabaseAdmin
        .from('storage_upgrades')
        .select('*')
        .eq('id', upgradeId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      if (!upgrade) {
        return res.status(404).json({ error: 'Không tìm thấy yêu cầu.' });
      }

      const { data: profile } = await supabaseAdmin
        .from('users')
        .select('wallet_balance')
        .eq('id', user.id)
        .maybeSingle();

      return res.status(200).json({
        upgrade,
        walletBalance: Number(profile?.wallet_balance ?? 0),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Không tải được yêu cầu.' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { ssdGb, backupGb } = req.body ?? {};

    if (!isValidPlanGb(ssdGb) || !isValidPlanGb(backupGb)) {
      return res.status(400).json({ error: 'Dung lượng gói không hợp lệ.' });
    }

    const requestedSsdGb = Number(ssdGb);
    const requestedBackupGb = Number(backupGb);
    const supabaseAdmin = getSupabaseAdmin();

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('ssd_plan_gb, backup_plan_gb')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    const currentSsdGb = profile?.ssd_plan_gb ?? 20;
    const currentBackupGb = profile?.backup_plan_gb ?? 20;

    if (requestedSsdGb === currentSsdGb && requestedBackupGb === currentBackupGb) {
      return res.status(400).json({ error: 'Gói bộ nhớ không thay đổi.' });
    }

    const { ssdUsed, backupUsed } = await getUserStorageUsage(supabaseAdmin, user.id);
    const downgradeErrors = validateStorageDowngrade(
      ssdUsed,
      backupUsed,
      requestedSsdGb,
      requestedBackupGb,
    );

    if (downgradeErrors.length > 0) {
      return res.status(400).json({
        error: downgradeErrors.map((e) => e.message).join(' '),
        errors: downgradeErrors,
      });
    }

    const { ssdPlans, backupPlans } = await getStoragePricingMaps(supabaseAdmin, {
      activeOnly: true,
    });

    const pricing = calcStoragePricingFromMaps(
      ssdPlans,
      backupPlans,
      currentSsdGb,
      currentBackupGb,
      requestedSsdGb,
      requestedBackupGb,
    );

    const { data: existingPending } = await supabaseAdmin
      .from('storage_upgrades')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingPending) {
      await supabaseAdmin
        .from('storage_upgrades')
        .update({ status: 'cancelled' })
        .eq('id', existingPending.id);
    }

    if (pricing.totalAmount === 0) {
      await applyUserStoragePlan(supabaseAdmin, user.id, requestedSsdGb, requestedBackupGb);

      await supabaseAdmin.from('storage_upgrades').insert({
        user_id: user.id,
        current_ssd_gb: currentSsdGb,
        current_backup_gb: currentBackupGb,
        requested_ssd_gb: requestedSsdGb,
        requested_backup_gb: requestedBackupGb,
        price_change_per_month: pricing.priceChangePerMonth,
        total_amount: 0,
        payment_status: 'paid',
        status: 'completed',
      });

      return res.status(200).json({
        success: true,
        ssdPlanGb: requestedSsdGb,
        backupPlanGb: requestedBackupGb,
        message: 'Đã cập nhật gói bộ nhớ.',
      });
    }

    const { data: upgrade, error: insertError } = await supabaseAdmin
      .from('storage_upgrades')
      .insert({
        user_id: user.id,
        current_ssd_gb: currentSsdGb,
        current_backup_gb: currentBackupGb,
        requested_ssd_gb: requestedSsdGb,
        requested_backup_gb: requestedBackupGb,
        price_change_per_month: pricing.priceChangePerMonth,
        total_amount: pricing.totalAmount,
        payment_status: 'unpaid',
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) throw insertError;

    const redirectUrl = `/dashboard/storage/checkout?id=${upgrade.id}&ssd=${requestedSsdGb}&backup=${requestedBackupGb}`;

    return res.status(200).json({
      success: true,
      upgradeId: upgrade.id,
      totalAmount: pricing.totalAmount,
      priceChangePerMonth: pricing.priceChangePerMonth,
      redirectUrl,
    });
  } catch (err) {
    console.error('[storage/upgrade]', err);
    return res.status(500).json({ error: err.message || 'Không tạo được yêu cầu nâng cấp.' });
  }
}
