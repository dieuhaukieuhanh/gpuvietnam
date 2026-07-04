import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { approveSupportSession, mapSupportSession } from '@/lib/support-sessions';
import { notifySupportSessionActive } from '@/lib/user-notifications';

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
    const result = await approveSupportSession(supabaseAdmin, {
      sessionId,
      userId: user.id,
    });

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    await notifySupportSessionActive(supabaseAdmin, { userId: user.id });

    return res.status(200).json({
      success: true,
      message: 'Đã cho phép Admin xem màn hình. Phiên tự kết thúc sau 30 phút.',
      session: mapSupportSession(result.data),
    });
  } catch (err) {
    console.error('[support/approve]', err);
    return res.status(500).json({ error: err.message || 'Không chấp nhận được phiên hỗ trợ.' });
  }
}
