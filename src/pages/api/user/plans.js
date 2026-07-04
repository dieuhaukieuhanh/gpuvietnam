import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { listUserPlans } from '@/lib/user-plan-inventory';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();
    const result = await listUserPlans(supabaseAdmin, user.id);

    return res.status(200).json(result);
  } catch (err) {
    console.error('[user/plans]', err);
    return res.status(500).json({ error: err.message || 'Không tải được danh sách gói.' });
  }
}
