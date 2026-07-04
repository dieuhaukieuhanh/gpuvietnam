import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useState } from 'react';
import AuthPageShell from '@/components/auth/AuthPageShell';
import { useAuth } from '@/contexts/AuthContext';
import { resolveLoginRedirectFromResponse } from '@/lib/post-login-redirect';
import { routes } from '@/lib/routes';

export default function LoginPage() {
  const router = useRouter();
  const { applySession } = useAuth();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

        <p className="auth-links">
          <Link href={routes.forgotPassword}>Quên mật khẩu?</Link>
          {' · '}
          <Link href={routes.register}>Tạo tài khoản mới</Link>
        </p>
      </form>
    </AuthPageShell>
  );
}
