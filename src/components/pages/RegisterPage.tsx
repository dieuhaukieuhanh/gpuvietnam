import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';
import AuthPageShell from '@/components/auth/AuthPageShell';
import { routes } from '@/lib/routes';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const trial = router.query.trial === 'true';
  const workstation = router.query.workstation as string | undefined;

  useEffect(() => {
    if (router.query.email) setEmail(String(router.query.email));
    if (router.query.phone) setPhone(String(router.query.phone));
  }, [router.query.email, router.query.phone]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          phone: phone.trim(),
          password: password.trim() || undefined,
          plan: router.query.plan,
          billing: router.query.billing,
          env: router.query.env,
          icon: router.query.icon,
          desc: router.query.desc,
          workstation,
          trial,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        if (result.code === 'phone_taken') {
          setError('SĐT đã có tài khoản. Vui lòng đăng nhập hoặc dùng SĐT khác.');
        } else {
          setError(result.error ?? 'Đăng ký thất bại.');
        }
        return;
      }

      const params = new URLSearchParams({
        phone: result.phone,
        email: result.email,
      });

      ['plan', 'billing', 'env', 'icon', 'desc', 'workstation'].forEach((key) => {
        const value = router.query[key];
        if (typeof value === 'string') params.set(key, value);
      });
      if (trial) params.set('trial', 'true');

      if (result.devOtp) {
        sessionStorage.setItem('gpuvietnam-dev-otp', String(result.devOtp));
      }

      router.push(`${routes.verifyOtp}?${params.toString()}`);
    } catch {
      setError('Không thể kết nối máy chủ.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthPageShell
      pageTitle="GPUVietnam – Đăng ký"
      formTitle="Tạo tài khoản"
      formSubtitle={
        trial
          ? 'Đăng ký để dùng thử 3 giờ GPU miễn phí'
          : 'Email + SĐT — mật khẩu có thể để trống'
      }
    >
      <form onSubmit={handleSubmit}>
        {error ? <div className="auth-error">{error}</div> : null}

        <div className="auth-field">
          <label htmlFor="email">Email *</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="phone">Số điện thoại *</label>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            placeholder="09xxxxxxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="password">Mật khẩu (tùy chọn)</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="Để trống → tự động tạo"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? 'Đang đăng ký...' : 'Đăng ký & nhận OTP →'}
        </button>

        <p className="auth-note">
          OTP gửi qua SMS. Mật khẩu để trống → hệ thống tự tạo.
          {process.env.NODE_ENV === 'development' ? ' Dev: OTP hiện ở bước tiếp theo.' : ''}
        </p>

        <p className="auth-links">
          Đã có tài khoản? <Link href={routes.login}>Đăng nhập</Link>
        </p>
      </form>
    </AuthPageShell>
  );
}
