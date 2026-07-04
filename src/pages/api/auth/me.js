import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { resolveUserRole, syncUserRoleOnLogin } from '@/lib/user-role';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET — Role và thông tin cơ bản của user đang đăng nhập.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();

    if (user.id && user.email) {
      await syncUserRoleOnLogin(supabaseAdmin, { userId: user.id, email: user.email });
    }

    const role = await resolveUserRole(supabaseAdmin, {
      userId: user.id,
      email: user.email,
    });

    return res.status(200).json({
      id: user.id,
      email: user.email,
      role,
      isAdmin: role === 'admin',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Không tải được thông tin phiên.' });
  }
}
