import { requireAdmin } from '@/lib/admin-auth';
import { notifyPaymentSuccess } from '@/lib/user-notifications';
import { syncUserPlanInventory } from '@/lib/user-plan-inventory';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * Admin xác nhận thanh toán.
 * Auth: Bearer (role=admin) hoặc x-admin-secret
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireAdmin(req, res))) return;

  try {
    const { subscriptionId } = req.body ?? {};
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Thiếu subscriptionId.' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .update({
        status: 'active',
        server_status: 'offline',
        activated_at: now,
      })
      .eq('id', subscriptionId)
      .eq('status', 'pending_payment')
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Không tìm thấy yêu cầu pending.' });
    }

    await notifyPaymentSuccess(supabaseAdmin, {
      userId: data.user_id,
      planName: data.plan,
    });

    await syncUserPlanInventory(supabaseAdmin, data.user_id);

    return res.status(200).json({
      success: true,
      subscription: data,
      message: 'Đã duyệt thanh toán và kích hoạt gói.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Duyệt thất bại.' });
  }
}
