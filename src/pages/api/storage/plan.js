import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('ssd_plan_gb, backup_plan_gb, wallet_balance')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    const { data: pendingUpgrade } = await supabaseAdmin
      .from('storage_upgrades')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: rejectedUpgrade } = await supabaseAdmin
      .from('storage_upgrades')
      .select('id, admin_note, requested_ssd_gb, requested_backup_gb, updated_at')
      .eq('user_id', user.id)
      .eq('status', 'rejected')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return res.status(200).json({
      ssdPlanGb: profile?.ssd_plan_gb ?? 50,
      backupPlanGb: profile?.backup_plan_gb ?? 100,
      walletBalance: Number(profile?.wallet_balance ?? 0),
      pendingUpgrade: pendingUpgrade ?? null,
      rejectedUpgrade: pendingUpgrade ? null : rejectedUpgrade ?? null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Không tải được thông tin bộ nhớ.' });
  }
}
