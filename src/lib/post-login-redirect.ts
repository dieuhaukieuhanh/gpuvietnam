import { routes } from '@/lib/routes';

export type UserRole = 'admin' | 'user';

export function isAdminRole(role?: string | null): role is 'admin' {
  return role === 'admin';
}

/** Gọi API xác nhận role sau khi có access_token. */
export async function fetchUserRoleFromApi(accessToken: string): Promise<UserRole> {
  try {
    const [adminRes, meRes] = await Promise.all([
      fetch('/api/admin/check', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ]);

    if (adminRes.ok) return 'admin';

    if (meRes.ok) {
      const data = (await meRes.json()) as { role?: string };
      return isAdminRole(data.role) ? 'admin' : 'user';
    }
  } catch {
    /* fallback below */
  }

  return 'user';
}

/** Đích redirect sau đăng nhập: admin → /admin, còn lại → /dashboard. */
export function getPostLoginDestination(role: string | null | undefined): string {
  return isAdminRole(role) ? routes.admin : routes.dashboard;
}

/** Ưu tiên role/redirect từ POST /api/auth/login, fallback gọi API. */
export function resolveLoginRedirectFromResponse(result: {
  role?: string | null;
  redirect?: string | null;
}): { role: UserRole; destination: string } {
  const role = isAdminRole(result.role) ? 'admin' : 'user';
  const destination =
    result.redirect && result.redirect.startsWith('/')
      ? result.redirect
      : getPostLoginDestination(role);

  return { role, destination };
}

/** Fetch role + trả URL đích (fallback khi không có redirect từ login API). */
export async function resolvePostLoginRedirect(accessToken: string): Promise<{
  role: UserRole;
  destination: string;
}> {
  const role = await fetchUserRoleFromApi(accessToken);
  return { role, destination: getPostLoginDestination(role) };
}
