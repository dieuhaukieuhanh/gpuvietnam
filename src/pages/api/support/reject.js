import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rejectSupportSession, mapSupportSession } from '@/lib/support-sessions';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const sessionId = Number(req.body?.sessionId);
    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ error: 'Thiếu sessionId.' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const result = await rejectSupportSession(supabaseAdmin, {
      sessionId,
      userId: user.id,
    });

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      message: 'Đã từ chối yêu cầu xem màn hình từ Admin.',
      session: mapSupportSession(result.data),
    });
  } catch (err) {
    console.error('[support/reject]', err);
    return res.status(500).json({ error: err.message || 'Không từ chối được yêu cầu.' });
  }
}
