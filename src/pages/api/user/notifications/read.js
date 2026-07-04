import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { markNotificationsRead } from '@/lib/user-notifications';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { id, all } = req.body ?? {};
    const supabaseAdmin = getSupabaseAdmin();
    const result = await markNotificationsRead(supabaseAdmin, user.id, { id, all });

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('[user/notifications/read]', err);
    return res.status(500).json({ error: err.message || 'Không cập nhật được thông báo.' });
  }
}
