import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { fetchUserActivePlans } from '@/lib/user-active-plans';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();
    const result = await fetchUserActivePlans(supabaseAdmin, user.id);

    return res.status(200).json(result);
  } catch (err) {
    console.error('[user/active-plans]', err);
    return res.status(500).json({ error: err.message || 'Không tải được gói đang active.' });
  }
}
