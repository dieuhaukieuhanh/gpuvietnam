import { requireAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createAdminSupportRequest, mapSupportSession } from '@/lib/support-sessions';
import { notifySupportRequestToCustomer } from '@/lib/user-notifications';

function resolveAdminId(adminCtx) {
  if (adminCtx?.mode === 'auth' && adminCtx.user?.id) {
    return adminCtx.user.id;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return undefined;

    const adminId = resolveAdminId(admin);
    const userId = req.body?.userId;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'Thiếu userId khách hàng.' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const session = await createAdminSupportRequest(supabaseAdmin, {
      userId,
      adminId,
    });

    await notifySupportRequestToCustomer(supabaseAdmin, {
      userId,
      sessionId: session.id,
    });

    return res.status(200).json({
      success: true,
      message: 'Đã gửi yêu cầu tới khách hàng. Họ sẽ chấp nhận qua thông báo 🔔.',
      session: mapSupportSession(session),
    });
  } catch (err) {
    console.error('[admin/support/request]', err);
    return res.status(500).json({ error: err.message || 'Không gửi được yêu cầu hỗ trợ.' });
  }
}
