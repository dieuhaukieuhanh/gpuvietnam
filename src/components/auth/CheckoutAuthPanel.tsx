import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { orderToSearchParams, type CheckoutOrder } from '@/lib/checkout-order';
import { resolvePostLoginRedirect } from '@/lib/post-login-redirect';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
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
  const [success, setSuccess] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);

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
    setSuccess(false);

    setLoading(true);

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
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
          result.code === 'email_taken'
            ? 'Email này đã có tài khoản. Vui lòng chuyển sang tab Đăng nhập.'
            : (result.error ?? 'Đăng ký thất bại.'),
        );
        return;
      }

      if (result.generatedPassword) {
        setGeneratedPassword(result.generatedPassword);
      }

      // Đăng ký thành công → hiển thị thông báo kiểm tra email
      setSuccess(true);
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

  const handleGoogleAuth = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      const supabase = getSupabaseBrowser();
      const redirectParams = new URLSearchParams();
      if (trial) redirectParams.set('trial', 'true');
      if (workstation) redirectParams.set('workstation', workstation);
      const redirectTo = `${window.location.origin}/auth/callback${redirectParams.toString() ? '?' + redirectParams.toString() : ''}`;

      const { error: googleError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
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

  if (success && mode === 'register') {
    return (
      <div className={`auth-panel${compact ? ' auth-panel-compact' : ''}`}>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📧</div>
          <h3 style={{ marginBottom: 8 }}>Kiểm tra email của bạn</h3>
          <p style={{ color: '#718096', fontSize: 14, marginBottom: 12 }}>
            Chúng tôi đã gửi link xác thực tới <strong>{email}</strong>.
            Nhấp vào link để kích hoạt tài khoản, sau đó đăng nhập để tiếp tục.
          </p>

          {generatedPassword ? (
            <div style={{
              background: '#fefcbf', border: '1px solid #ecc94b', borderRadius: 8,
              padding: 12, marginBottom: 16, textAlign: 'left',
            }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#975a16' }}>
                ⚠️ Mật khẩu của bạn (chỉ hiện 1 lần):
              </p>
              <code style={{
                display: 'block', marginTop: 6, padding: '6px 10px',
                background: '#fff', borderRadius: 4, fontSize: 16,
                fontFamily: 'monospace', letterSpacing: 1, color: '#1a202c',
                wordBreak: 'break-all', textAlign: 'center',
              }}>
                {generatedPassword}
              </code>
              <p style={{ margin: '6px 0 0', fontSize: 11, color: '#975a16' }}>
                📋 Sao chép & lưu lại ngay — sẽ không hiển thị lại.
              </p>
            </div>
          ) : (
            <p style={{ color: '#718096', fontSize: 13, marginBottom: 16 }}>
              Sau khi xác thực email, đăng nhập bằng email và mật khẩu để tiếp tục.
            </p>
          )}

          {trial && (
            <p style={{ color: '#dd6b20', fontSize: 13, marginBottom: 16 }}>
              ⚠️ Để nhận GPU miễn phí, bạn cần xác thực SĐT trong Dashboard sau khi đăng nhập.
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setMode('login');
              setSuccess(false);
              setPassword('');
              setGeneratedPassword('');
            }}
          >
            Đi tới Đăng nhập →
          </button>
        </div>
      </div>
    );
  }

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
            <label htmlFor="auth-password">Mật khẩu (tùy chọn)</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Để trống → hệ thống tự tạo & gửi qua email"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Đang xử lý...' : 'Tạo tài khoản →'}
          </button>
          <p className="form-note">
            Sau đăng ký, kiểm tra email để xác thực. SĐT có thể thêm sau trong Dashboard để nhận ưu đãi.
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

          <div className="auth-divider" style={{ margin: '12px 0' }}>
            <span>hoặc</span>
          </div>

          <button type="button" className="auth-google-btn" onClick={handleGoogleAuth} disabled={googleLoading}>
            <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {googleLoading ? 'Đang kết nối Google...' : 'Đăng nhập bằng Google'}
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
