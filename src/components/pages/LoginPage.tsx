import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useState } from 'react';
import AuthPageShell from '@/components/auth/AuthPageShell';
import { useAuth } from '@/contexts/AuthContext';
import { resolveLoginRedirectFromResponse } from '@/lib/post-login-redirect';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { routes } from '@/lib/routes';

export default function LoginPage() {
  const router = useRouter();
  const { applySession } = useAuth();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!email.trim() && !phone.trim()) {
      setError('Vui lòng nhập email hoặc SĐT.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          password,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Đăng nhập thất bại.');
        return;
      }

      const { role, destination } = resolveLoginRedirectFromResponse(result);
      await applySession(result.session, { role });
      await router.replace(destination);
    } catch {
      setError('Đăng nhập thất bại.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error: googleError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
      if (googleError) {
        setError(googleError.message);
        setGoogleLoading(false);
      }
    } catch {
      setError('Không thể kết nối Google.');
      setGoogleLoading(false);
    }
  };

  return (
    <AuthPageShell
      pageTitle="GPUVietnam – Đăng nhập"
      formTitle="Đăng nhập"
      formSubtitle="Email hoặc SĐT + mật khẩu"
    >
      <form onSubmit={handleSubmit}>
        {error ? <div className="auth-error">{error}</div> : null}

        <div className="auth-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="auth-field">
          <label htmlFor="phone">Hoặc Số điện thoại</label>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            placeholder="09xxxxxxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div className="auth-field">
          <label htmlFor="password">Mật khẩu *</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>

        <div className="auth-divider">
          <span>hoặc</span>
        </div>

        <button type="button" className="auth-google-btn" onClick={handleGoogleLogin} disabled={googleLoading}>
          <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {googleLoading ? 'Đang kết nối Google...' : 'Đăng nhập bằng Google'}
        </button>

        <p className="auth-links">
          <Link href={routes.forgotPassword}>Quên mật khẩu?</Link>
          {' · '}
          <Link href={routes.register}>Tạo tài khoản mới</Link>
        </p>
      </form>
    </AuthPageShell>
  );
}
