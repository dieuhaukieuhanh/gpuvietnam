import { getAdminUserFromRequest, getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { endSupportSession, mapSupportSession } from '@/lib/support-sessions';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionId = Number(req.body?.sessionId);
    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ error: 'Thiếu sessionId.' });
    }

    const adminUser = await getAdminUserFromRequest(req);
    const customerUser = adminUser ? null : await getAuthUserFromRequest(req);

    if (!adminUser && !customerUser) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();
    const result = await endSupportSession(supabaseAdmin, {
      sessionId,
      actorUserId: adminUser?.user?.id ?? customerUser.id,
      isAdmin: Boolean(adminUser),
    });

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      message: 'Đã kết thúc phiên hỗ trợ từ xa.',
      session: mapSupportSession(result.data),
    });
  } catch (err) {
    console.error('[support/end]', err);
    return res.status(500).json({ error: err.message || 'Không kết thúc được phiên hỗ trợ.' });
  }
}
