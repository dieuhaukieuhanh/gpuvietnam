import { getAuthUserFromRequest } from '@/lib/api-auth';
import { resolveUserRole } from '@/lib/user-role';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * Kiểm tra header x-admin-secret (không gửi response).
 */
export function isAdminSecretValid(req) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return false;
  return req.headers['x-admin-secret'] === adminSecret;
}

/**
 * User đăng nhập Supabase Auth + users.role = 'admin'.
 */
export async function getAdminUserFromRequest(req) {
  const user = await getAuthUserFromRequest(req);
  if (!user) return null;

  const supabaseAdmin = getSupabaseAdmin();
  const role = await resolveUserRole(supabaseAdmin, {
    userId: user.id,
    email: user.email,
  });

  if (role !== 'admin') return null;

  const { data: profile, error } = await supabaseAdmin
    .from('users')
    .select('id, email, phone, role')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[admin-auth] Không đọc được users.role:', error.message);
  }

  return {
    user,
    profile: profile ?? {
      id: user.id,
      email: user.email,
      role: 'admin',
    },
  };
}

/**
 * Ưu tiên Auth admin, fallback ADMIN_SECRET.
 * Trả về null nếu không hợp lệ (đã gửi 403).
 */
export async function requireAdmin(req, res) {
  const adminUser = await getAdminUserFromRequest(req);
  if (adminUser) {
    return { mode: 'auth', ...adminUser };
  }

  if (isAdminSecretValid(req)) {
    return { mode: 'secret' };
  }

  res.status(403).json({ error: 'Không có quyền admin.' });
  return null;
}

/** Alias của requireAdmin — dùng trong API routes admin. */
export async function verifyAdmin(req, res) {
  return requireAdmin(req, res);
}

/** @deprecated Dùng requireAdmin */
export function verifyAdminSecret(req, res) {
  if (isAdminSecretValid(req)) return true;
  res.status(403).json({ error: 'Không có quyền admin.' });
  return false;
}
