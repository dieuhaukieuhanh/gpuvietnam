import { getAdminUserFromRequest, isAdminSecretValid } from '@/lib/admin-auth';

/**
 * Kiểm tra quyền admin — Auth role hoặc ADMIN_SECRET.
 * GET → { ok: true, mode: 'auth' | 'secret' }
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminUser = await getAdminUserFromRequest(req);
  if (adminUser) {
    return res.status(200).json({
      ok: true,
      mode: 'auth',
      email: adminUser.profile.email,
    });
  }

  if (isAdminSecretValid(req)) {
    return res.status(200).json({ ok: true, mode: 'secret' });
  }

  const hasToken = Boolean(req.headers.authorization?.replace(/^Bearer\s+/i, '').trim());
  const hasSecret = Boolean(req.headers['x-admin-secret']);

  let reason = 'no_auth';
  if (hasToken) reason = 'not_admin';
  else if (hasSecret) reason = 'invalid_secret';

  return res.status(403).json({
    error:
      reason === 'not_admin'
        ? 'Tài khoản chưa có quyền admin.'
        : reason === 'invalid_secret'
          ? 'Mã admin không đúng.'
          : 'Không có quyền admin.',
    reason,
  });
}
