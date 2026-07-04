import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { clearAdminSecret, getAdminSecret, setAdminSecret } from '@/lib/admin-session';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

type AdminAuthGateProps = {
  children?: ReactNode;
};

type DenyReason = 'not_admin' | 'invalid_secret' | 'no_auth' | null;

async function verifyAdminAccess(
  token?: string,
  secret?: string,
): Promise<{ ok: boolean; reason?: DenyReason }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (secret) headers['x-admin-secret'] = secret;
  else return { ok: false, reason: 'no_auth' };

  const res = await fetch('/api/admin/check', { headers });
  if (res.ok) return { ok: true };

  const data = await res.json().catch(() => ({}));
  return { ok: false, reason: (data.reason as DenyReason) ?? 'no_auth' };
}

export default function AdminAuthGate({ children }: AdminAuthGateProps) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [loggedInEmail, setLoggedInEmail] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState<DenyReason>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const checkAuth = useCallback(async () => {
    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const email = session?.user?.email ?? null;
      setLoggedInEmail(email);

      // Ưu tiên 1: tài khoản đăng nhập + role admin (kiểm tra qua API server)
      if (session?.access_token) {
        const authResult = await verifyAdminAccess(session.access_token);
        if (authResult.ok) {
          setAuthorized(true);
          setDenyReason(null);
          return;
        }
        if (authResult.reason === 'not_admin') {
          setDenyReason('not_admin');
        }
      }

      // Ưu tiên 2: ADMIN_SECRET đã lưu
      const storedSecret = getAdminSecret();
      if (storedSecret) {
        const secretResult = await verifyAdminAccess(undefined, storedSecret);
        if (secretResult.ok) {
          setAuthorized(true);
          setDenyReason(null);
          return;
        }
        clearAdminSecret();
      }

      setAuthorized(false);
    } catch {
      setAuthorized(false);
      setDenyReason(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      await checkAuth();
    }

    init();

    const supabase = getSupabaseBrowser();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      if (mounted) checkAuth();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [checkAuth]);

  const handleSecretLogin = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setError('Vui lòng nhập mã admin.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await verifyAdminAccess(undefined, trimmed);

      if (!result.ok) {
        setError(
          result.reason === 'invalid_secret'
            ? 'Mã admin không đúng. Kiểm tra ADMIN_SECRET trong .env.local và restart npm run dev.'
            : 'Không xác thực được. Thử lại.',
        );
        return;
      }

      setAdminSecret(trimmed);
      setAuthorized(true);
      setDenyReason(null);
    } catch {
      setError('Lỗi mạng. Thử lại sau.');
    } finally {
      setLoading(false);
    }
  }, [input]);

  if (authorized === null) {
    return (
      <div className="admin-auth-screen">
        <div className="admin-auth-card" style={{ textAlign: 'center' }}>
          <p className="text-muted">Đang kiểm tra quyền truy cập...</p>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="admin-auth-screen">
        <div className="admin-auth-card">
          <div className="admin-auth-brand">
            <div className="logo">GPU</div>
            <div>
              <h1>
                GPU<span>Vietnam</span>
              </h1>
              <small>Admin — Duyệt thanh toán</small>
            </div>
          </div>

          {denyReason === 'not_admin' && loggedInEmail && (
            <div
              className="card"
              style={{
                marginBottom: 16,
                padding: 12,
                background: '#2E200A',
                borderColor: '#F59E0B',
              }}
            >
              <p style={{ color: '#F59E0B', marginBottom: 4 }}>
                Đã đăng nhập <strong>{loggedInEmail}</strong> nhưng tài khoản chưa có quyền admin.
              </p>
              <p className="text-muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                Chạy trên Supabase SQL Editor:{' '}
                <code>{`update public.users set role = 'admin' where email = '${loggedInEmail}';`}</code>
              </p>
            </div>
          )}

          <p className="text-muted" style={{ marginBottom: 16 }}>
            Đăng nhập tài khoản <code>role = admin</code>, hoặc nhập mã dự phòng bên dưới.
          </p>

          {!loggedInEmail && (
            <a
              href="/login?redirect=/admin"
              className="btn btn-primary"
              style={{ width: '100%', marginBottom: 16, justifyContent: 'center' }}
            >
              Đăng nhập bằng tài khoản Admin
            </a>
          )}

          {loggedInEmail && denyReason !== 'not_admin' && (
            <p className="text-muted" style={{ marginBottom: 12, fontSize: 12 }}>
              Đang đăng nhập: <strong>{loggedInEmail}</strong>
            </p>
          )}

          {!loggedInEmail && (
            <div
              className="separator-text"
              style={{ textAlign: 'center', margin: '12px 0', color: '#8888A0' }}
            >
              — hoặc —
            </div>
          )}

          <p className="text-muted" style={{ marginBottom: 8 }}>
            Mã dự phòng: <code>ADMIN_SECRET</code> trong <code>.env.local</code>
          </p>
          <div className="form-group">
            <label htmlFor="adminSecret">Mã admin (dự phòng)</label>
            <input
              id="adminSecret"
              className="form-control"
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSecretLogin()}
              placeholder="gpuvietnam-admin-2026"
              autoComplete="off"
            />
          </div>
          {error && (
            <p className="text-red" style={{ marginTop: 8 }}>
              {error}
            </p>
          )}
          <button
            type="button"
            className="btn btn-success"
            style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}
            onClick={handleSecretLogin}
            disabled={loading}
          >
            {loading ? 'Đang xác thực...' : 'Truy cập bằng mã'}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
