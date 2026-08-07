import Head from 'next/head';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useRef, useState } from 'react';
import PublicHeader from '@/components/layout/PublicHeader';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/checkout-flow.styles';

export default function VerifyOtpPage() {
  const router = useRouter();
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [resendIn, setResendIn] = useState(60);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const phone = router.query.phone as string | undefined;
  const redirect = (router.query.redirect as string) || routes.dashboardCaiDat;

  useEffect(() => {
    if (!router.isReady) return;
    if (!phone) router.replace(routes.dashboardCaiDat);
  }, [router, phone]);

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
        body: JSON.stringify({ phone, otp }),
      });

      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'OTP không hợp lệ.');
        return;
      }

      setSuccess(true);
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
        body: JSON.stringify({ phone }),
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
        <title>GPUVietnam – Xác thực SĐT</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>

      <PublicHeader showNav={false} showCta={false} />

      <main className="main-content">
        <div className="container">
          <h2 className="section-title">Xác thực số điện thoại</h2>
          <p className="section-subtitle">
            Nhập mã 6 số đã gửi tới <strong>{phone}</strong>
          </p>

          <div className="form-card">
            {success ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
                <h3 style={{ marginBottom: 8 }}>Xác thực thành công!</h3>
                <p style={{ color: '#718096', fontSize: 14, marginBottom: 20 }}>
                  Số điện thoại <strong>{phone}</strong> đã được xác thực.
                  Bạn có thể nhận khuyến mại và dùng thử GPU miễn phí.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => router.push(redirect)}
                >
                  {redirect.includes('dashboard') ? 'Về Dashboard →' : 'Tiếp tục →'}
                </button>
              </div>
            ) : (
              <>
                {devOtp && (
                  <div className="dev-otp-banner">
                    <strong>🧪 Dev mode — chưa cấu hình Zalo/SMS</strong>
                    <p>
                      Mã OTP của bạn: <span className="dev-otp-code">{devOtp}</span>
                    </p>
                    <p className="dev-otp-hint">Trên production, mã sẽ gửi qua Zalo hoặc SMS.</p>
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
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
