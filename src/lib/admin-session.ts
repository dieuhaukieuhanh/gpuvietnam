const STORAGE_KEY = 'gpuvietnam-admin-secret';

export function getAdminSecret(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function setAdminSecret(secret: string): void {
  sessionStorage.setItem(STORAGE_KEY, secret);
}

export function clearAdminSecret(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export async function adminFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const secret = getAdminSecret();
  if (secret) {
    headers.set('x-admin-secret', secret);
  } else {
    const { getSupabaseBrowser } = await import('@/lib/supabase-browser');
    const { data } = await getSupabaseBrowser().auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      throw new Error('Chưa đăng nhập admin.');
    }
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(path, { ...options, headers });
}
