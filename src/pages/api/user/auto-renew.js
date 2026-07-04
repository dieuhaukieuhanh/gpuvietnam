import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { executeAutoRenew } from '@/lib/auto-renew';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST — Kiểm tra và thực hiện gia hạn tự động (hours_remaining <= threshold).
 * Gọi khi KH mở Dashboard hoặc sau phiên làm việc.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();
    const result = await executeAutoRenew(supabaseAdmin, user.id);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('[user/auto-renew]', err);
    return res.status(500).json({ error: err.message || 'Gia hạn tự động thất bại.' });
  }
}
