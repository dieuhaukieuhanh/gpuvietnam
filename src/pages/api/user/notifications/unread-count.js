import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getUnreadNotificationCount } from '@/lib/user-notifications';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();
    const count = await getUnreadNotificationCount(supabaseAdmin, user.id);

    return res.status(200).json({ count });
  } catch (err) {
    console.error('[user/notifications/unread-count]', err);
    return res.status(500).json({ error: err.message || 'Không đếm được thông báo.' });
  }
}
