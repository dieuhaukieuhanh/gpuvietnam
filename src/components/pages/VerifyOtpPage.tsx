import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useRef, useState } from 'react';
import PublicHeader from '@/components/layout/PublicHeader';
import { useAuth } from '@/contexts/AuthContext';
import { resolvePostLoginRedirect } from '@/lib/post-login-redirect';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/checkout-flow.styles';

export default function VerifyOtpPage() {
  const router = useRouter();
  const { applySession } = useAuth();
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(60);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const phone = router.query.phone as string | undefined;
  const email = router.query.email as string | undefined;
  useEffect(() => {
    if (!router.isReady) return;
    if (!phone || !email) router.replace(routes.register);
  }, [router, phone, email]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem('gpuvietnam-dev-otp');
    if (stored) {
      setDevOtp(stored);
      sessionStorage.removeItem('gpuvietnam-dev-otp');
    }
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < 5) inputsRef.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, key: string) => {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const otp = digits.join('');
    if (otp.length !== 6) {
      setError('Vui lòng nhập đủ 6 số OTP.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp, email }),
      });

      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'OTP không hợp lệ.');
        return;
      }

      const { role, destination } = await resolvePostLoginRedirect(result.session.access_token);

      await applySession(result.session, { role });
      router.push(destination);
    } catch {
      setError('Xác thực thất bại. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (resendIn > 0 || !phone) return;
    setError('');

    try {
      const response = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, email }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Không gửi lại được OTP.');
        return;
      }
      setResendIn(60);
      setDigits(['', '', '', '', '', '']);
      if (result.devOtp) setDevOtp(String(result.devOtp));
      inputsRef.current[0]?.focus();
    } catch {
      setError('Không gửi lại được OTP.');
    }
  };

  if (!router.isReady || !phone) return null;

  return (
    <>
      <Head>
        <title>GPUVietnam – Xác thực OTP</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>

      <PublicHeader showNav={false} showCta={false} />

      <main className="main-content">
        <div className="container">
          <h2 className="section-title">Xác thực OTP</h2>
          <p className="section-subtitle">
            Nhập mã 6 số đã gửi tới <strong>{phone}</strong>
          </p>

          <div className="form-card">
            {devOtp && (
              <div className="dev-otp-banner">
                <strong>🧪 Dev mode — chưa cấu hình Speedsms</strong>
                <p>
                  Mã OTP của bạn: <span className="dev-otp-code">{devOtp}</span>
                </p>
                <p className="dev-otp-hint">Trên production, mã sẽ gửi qua SMS tới SĐT trên.</p>
              </div>
            )}
            <form onSubmit={handleSubmit}>
              {error && <div className="error-msg">{error}</div>}

              <div className="otp-inputs">
                {digits.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => {
                      inputsRef.current[index] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e.key)}
                    className="otp-box"
                  />
                ))}
              </div>

              <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: 20 }}>
                {loading ? 'Đang xác thực...' : 'Xác thực'}
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: 10, width: '100%' }}
                onClick={resendOtp}
                disabled={resendIn > 0}
              >
                {resendIn > 0 ? `Gửi lại OTP (${resendIn}s)` : 'Gửi lại OTP'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </>
  );
}
