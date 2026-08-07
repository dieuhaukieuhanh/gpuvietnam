import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import AuthPageShell from '@/components/auth/AuthPageShell';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { routes } from '@/lib/routes';

function getPasswordStrength(password: string): { label: string; color: string; pct: number } {
  if (!password) return { label: '', color: '#ccc', pct: 0 };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const pct = Math.min(100, score * 20);
  if (score <= 1) return { label: 'Yếu', color: '#e53e3e', pct };
  if (score <= 3) return { label: 'Trung bình', color: '#dd6b20', pct };
  return { label: 'Mạnh', color: '#38a169', pct };
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);

  const trial = router.query.trial === 'true';
  const workstation = router.query.workstation as string | undefined;
  const showPasswordFields = password.length > 0;
  const strength = useMemo(() => getPasswordStrength(password), [password]);

  useEffect(() => {
    if (router.query.email) setEmail(String(router.query.email));
  }, [router.query.email]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    // Client-side password validation
    if (password.trim()) {
      if (password.trim().length < 8) {
        setError('Mật khẩu tối thiểu 8 ký tự.');
        return;
      }
      if (!/[A-Z]/.test(password.trim())) {
        setError('Mật khẩu cần ít nhất 1 chữ hoa.');
        return;
      }
      if (!/\d/.test(password.trim())) {
        setError('Mật khẩu cần ít nhất 1 chữ số.');
        return;
      }
      if (password.trim() !== confirmPassword.trim()) {
        setError('Mật khẩu xác nhận không khớp.');
        return;
      }
    }

    setLoading(true);

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password: password.trim() || undefined,
          confirmPassword: confirmPassword.trim() || undefined,
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
        if (result.code === 'email_taken') {
          setError('Email này đã được đăng ký. Vui lòng đăng nhập hoặc khôi phục mật khẩu.');
        } else if (result.code === 'disposable_email') {
          setError(result.error);
        } else {
          setError(result.error ?? 'Đăng ký thất bại.');
        }
        return;
      }

      // Lưu mật khẩu tự tạo để hiển thị cho user
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

  const handleGoogleSignUp = async () => {
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

  if (success) {
    return (
      <AuthPageShell
        pageTitle="GPUVietnam – Kiểm tra email"
        formTitle="Đăng ký thành công!"
        formSubtitle="Vui lòng kiểm tra hộp thư để xác thực tài khoản."
      >
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
          <p style={{ marginBottom: 8 }}>
            Chúng tôi đã gửi email xác thực tới <strong>{email}</strong>
          </p>

          {generatedPassword ? (
            <div style={{
              background: '#fefcbf', border: '1px solid #ecc94b', borderRadius: 8,
              padding: 14, marginBottom: 20, textAlign: 'left',
            }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#975a16' }}>
                ⚠️ Mật khẩu của bạn (chỉ hiện 1 lần):
              </p>
              <code style={{
                display: 'block', marginTop: 8, padding: '8px 12px',
                background: '#fff', borderRadius: 4, fontSize: 18,
                fontFamily: 'monospace', letterSpacing: 1, color: '#1a202c',
                wordBreak: 'break-all', textAlign: 'center',
              }}>
                {generatedPassword}
              </code>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#975a16' }}>
                📋 Hãy sao chép và lưu lại ngay — mật khẩu này sẽ không hiển thị lại.
              </p>
            </div>
          ) : (
            <p style={{ color: '#718096', fontSize: 14, marginBottom: 24 }}>
              Nhấp vào link trong email để kích hoạt tài khoản, sau đó đăng nhập bằng email và mật khẩu.
            </p>
          )}
          {trial && (
            <p style={{ color: '#dd6b20', fontSize: 13, marginBottom: 16 }}>
              ⚠️ Để nhận 3 giờ GPU miễn phí, bạn cần xác thực SĐT trong Dashboard sau khi đăng nhập.
            </p>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href={routes.login} className="auth-submit" style={{ textDecoration: 'none' }}>
              Đi tới Đăng nhập →
            </Link>
          </div>
          <p style={{ marginTop: 16, fontSize: 13, color: '#718096' }}>
            Chưa nhận được email? Kiểm tra thư mục Spam hoặc{' '}
            <Link href={routes.register}>đăng ký lại</Link>
          </p>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell
      pageTitle="GPUVietnam – Đăng ký"
      formTitle="Tạo tài khoản"
      formSubtitle={
        trial
          ? 'Đăng ký để dùng thử 3 giờ GPU miễn phí (cần xác thực SĐT sau)'
          : 'Đăng ký nhanh bằng email — vào dùng ngay'
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
            placeholder="ban@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="password">Mật khẩu (tùy chọn)</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="Để trống → hệ thống tự tạo & gửi qua email"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {showPasswordFields && (
            <div className="password-strength" style={{ marginTop: 6 }}>
              <div className="strength-bar-bg" style={{ height: 4, background: '#e2e8f0', borderRadius: 2 }}>
                <div
                  className="strength-bar-fill"
                  style={{ height: '100%', width: `${strength.pct}%`, background: strength.color, borderRadius: 2, transition: 'width 0.2s' }}
                />
              </div>
              {strength.label && <small style={{ color: strength.color }}>{strength.label}</small>}
            </div>
          )}
        </div>

        {showPasswordFields && (
          <div className="auth-field">
            <label htmlFor="confirmPassword">Xác nhận mật khẩu</label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Nhập lại mật khẩu"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        )}

        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? 'Đang đăng ký...' : 'Tạo tài khoản →'}
        </button>

        <div className="auth-divider">
          <span>hoặc</span>
        </div>

        <button type="button" className="auth-google-btn" onClick={handleGoogleSignUp} disabled={googleLoading}>
          <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {googleLoading ? 'Đang kết nối Google...' : 'Đăng ký bằng Google'}
        </button>

        <p className="auth-note">
          Đăng ký bằng Google — không cần mật khẩu, xác thực ngay.{' '}
          SĐT có thể thêm sau trong Dashboard để nhận ưu đãi.
        </p>

        <p className="auth-links">
          Đã có tài khoản? <Link href={routes.login}>Đăng nhập</Link>
        </p>
      </form>
    </AuthPageShell>
  );
}
