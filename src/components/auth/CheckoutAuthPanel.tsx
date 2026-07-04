import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { orderToSearchParams, type CheckoutOrder } from '@/lib/checkout-order';
import { resolvePostLoginRedirect } from '@/lib/post-login-redirect';
import { routes } from '@/lib/routes';

type CheckoutAuthPanelProps = {
  order?: Partial<CheckoutOrder> | null;
  trial?: boolean;
  workstation?: string;
  onAuthenticated?: () => void;
  compact?: boolean;
};

export default function CheckoutAuthPanel({
  order,
  trial = false,
  workstation,
  onAuthenticated,
  compact = false,
}: CheckoutAuthPanelProps) {
  const router = useRouter();
  const { applySession } = useAuth();
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const buildLoginHref = () => {
    const params = new URLSearchParams();
    if (order?.plan) params.set('plan', order.plan);
    if (order?.billing) params.set('billing', order.billing);
    if (order?.env) params.set('env', order.env);
    if (order?.icon) params.set('icon', order.icon);
    if (order?.desc) params.set('desc', order.desc);
    if (trial) params.set('trial', 'true');
    if (workstation) params.set('workstation', workstation);
    params.set('redirect', routes.checkoutPlan);
    return `${routes.login}?${params.toString()}`;
  };

  const handleRegister = async (e: FormEvent) => {
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
          plan: order?.plan,
          billing: order?.billing,
          env: order?.env,
          icon: order?.icon,
          desc: order?.desc,
          workstation,
          trial,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        setError(
          result.code === 'phone_taken'
            ? 'SĐT đã có tài khoản. Vui lòng chuyển sang tab Đăng nhập.'
            : (result.error ?? 'Đăng ký thất bại.'),
        );
        return;
      }

      const verifyParams = new URLSearchParams({
        phone: result.phone,
        email: result.email,
      });
      if (order?.plan) verifyParams.set('plan', order.plan);
      if (order?.billing) verifyParams.set('billing', order.billing);
      if (order?.env) verifyParams.set('env', order.env);
      if (order?.icon) verifyParams.set('icon', order.icon);
      if (order?.desc) verifyParams.set('desc', order.desc);
      if (trial) verifyParams.set('trial', 'true');
      if (workstation) verifyParams.set('workstation', workstation);

      if (result.devOtp) {
        sessionStorage.setItem('gpuvietnam-dev-otp', String(result.devOtp));
      }

      window.location.href = `${routes.verifyOtp}?${verifyParams.toString()}`;
    } catch {
      setError('Không thể kết nối máy chủ.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          phone: phone.trim() || undefined,
          password,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Đăng nhập thất bại.');
        return;
      }

      const { role, destination } = await resolvePostLoginRedirect(result.session.access_token);

      await applySession(result.session, { role });

      if (destination === routes.admin) {
        router.push(destination);
        return;
      }

      onAuthenticated?.();
    } catch {
      setError('Đăng nhập thất bại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`auth-panel${compact ? ' auth-panel-compact' : ''}`}>
      <div className="auth-panel-tabs">
        <button
          type="button"
          className={mode === 'register' ? 'active' : ''}
          onClick={() => setMode('register')}
        >
          Đăng ký
        </button>
        <button
          type="button"
          className={mode === 'login' ? 'active' : ''}
          onClick={() => setMode('login')}
        >
          Đăng nhập
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {mode === 'register' ? (
        <form onSubmit={handleRegister}>
          <div className="form-group">
            <label htmlFor="auth-email">Email *</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ban@email.com"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="auth-phone">Số điện thoại *</label>
            <input
              id="auth-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09xxxxxxxx"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="auth-password">Mật khẩu (tùy chọn)</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Để trống → tự động tạo"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Đang xử lý...' : 'Đăng ký & xác thực OTP →'}
          </button>
          <p className="form-note">
            Sau đăng ký bạn sẽ nhận OTP qua SMS để xác thực SĐT trước khi thanh toán.
          </p>
        </form>
      ) : (
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ban@email.com"
            />
          </div>
          <div className="form-group">
            <label htmlFor="login-phone">Hoặc SĐT</label>
            <input
              id="login-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09xxxxxxxx"
            />
          </div>
          <div className="form-group">
            <label htmlFor="login-password">Mật khẩu *</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
          <p className="form-note">
            <Link href={routes.login}>Quên mật khẩu?</Link>
          </p>
        </form>
      )}

      {!compact && (
        <p className="auth-switch">
          {mode === 'register' ? (
            <>
              Đã có tài khoản? <Link href={buildLoginHref()}>Đăng nhập</Link>
            </>
          ) : (
            <>
              Chưa có tài khoản?{' '}
              <Link
                href={`${routes.register}?${order ? orderToSearchParams(order as CheckoutOrder).toString() : ''}`}
              >
                Đăng ký
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
