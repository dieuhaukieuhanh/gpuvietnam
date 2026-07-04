import { requireAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * Admin từ chối yêu cầu thanh toán.
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

    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'cancelled', server_status: 'offline' })
      .eq('id', subscriptionId)
      .eq('status', 'pending_payment')
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Không tìm thấy yêu cầu pending.' });
    }

    return res.status(200).json({
      success: true,
      subscription: data,
      message: 'Đã từ chối yêu cầu thanh toán.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Từ chối thất bại.' });
  }
}
