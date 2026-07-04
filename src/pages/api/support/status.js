import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  getOpenSupportSessionForUser,
  mapSupportSession,
} from '@/lib/support-sessions';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();
    const row = await getOpenSupportSessionForUser(supabaseAdmin, user.id);

    return res.status(200).json({
      session: mapSupportSession(row),
    });
  } catch (err) {
    console.error('[support/status]', err);
    return res.status(500).json({ error: err.message || 'Không tải được trạng thái hỗ trợ.' });
  }
}
