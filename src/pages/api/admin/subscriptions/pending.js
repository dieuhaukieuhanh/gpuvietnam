import { requireAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * Danh sách subscription đang chờ Admin duyệt thanh toán.
 * Auth: Bearer (role=admin) hoặc x-admin-secret
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireAdmin(req, res))) return;

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: subscriptions, error } = await supabaseAdmin
      .from('subscriptions')
      .select(
        'id, user_id, plan, billing, env_name, env_icon, env_desc, gpu_label, hours_total, transfer_note, created_at',
      )
      .eq('status', 'pending_payment')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const userIds = [...new Set((subscriptions ?? []).map((s) => s.user_id))];
    let usersById = {};

    if (userIds.length > 0) {
      const { data: users, error: usersError } = await supabaseAdmin
        .from('users')
        .select('id, email, phone')
        .in('id', userIds);

      if (usersError) throw usersError;

      usersById = Object.fromEntries((users ?? []).map((u) => [u.id, u]));
    }

    const items = (subscriptions ?? []).map((sub) => ({
      ...sub,
      user: usersById[sub.user_id] ?? null,
    }));

    return res.status(200).json({ items, count: items.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Không tải được danh sách.' });
  }
}
