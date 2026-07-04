import { requireAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireAdmin(req, res))) return;

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: upgrades, error } = await supabaseAdmin
      .from('storage_upgrades')
      .select('*')
      .eq('status', 'pending')
      .eq('payment_method', 'transfer')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const userIds = [...new Set((upgrades ?? []).map((u) => u.user_id))];
    let usersById = {};

    if (userIds.length > 0) {
      const { data: users, error: usersError } = await supabaseAdmin
        .from('users')
        .select('id, email, phone')
        .in('id', userIds);

      if (usersError) throw usersError;
      usersById = Object.fromEntries((users ?? []).map((u) => [u.id, u]));
    }

    const items = (upgrades ?? []).map((row) => ({
      ...row,
      user: usersById[row.user_id] ?? null,
    }));

    return res.status(200).json({ items, count: items.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Không tải được danh sách.' });
  }
}
