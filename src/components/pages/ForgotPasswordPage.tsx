import Head from 'next/head';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import PublicHeader from '@/components/layout/PublicHeader';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/checkout-flow.styles';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() && !phone.trim()) {
      setError('Vui lòng nhập email hoặc SĐT.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Không gửi được email.');
        return;
      }

      setSent(true);
      setSentEmail(result.email ?? email.trim());
    } catch {
      setError('Lỗi mạng. Thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>GPUVietnam – Quên mật khẩu</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>

      <PublicHeader showNav={false} showCta={false} />

      <main className="main-content">
        <div className="container">
          <h2 className="section-title">Quên mật khẩu</h2>
          <p className="section-subtitle">
            Nhập email hoặc SĐT đã đăng ký — link đặt lại sẽ gửi tới email của bạn
          </p>

          <div className="form-card">
            {sent ? (
              <>
                <div className="success-msg">
                  Đã gửi link đặt lại mật khẩu tới <strong>{sentEmail}</strong>.
                  <br />
                  Kiểm tra hộp thư và mục Spam. Link có hiệu lực khoảng 1 giờ.
                </div>
                <Link href={routes.login} className="btn btn-primary" style={{ marginTop: 16 }}>
                  Quay lại đăng nhập
                </Link>
              </>
            ) : (
              <form onSubmit={handleSubmit}>
                {error && <div className="error-msg">{error}</div>}

                <div className="form-group">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="cuong89809@gmail.com"
                  />
                </div>

                <div className="form-group">
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

                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? 'Đang gửi...' : 'Gửi link đặt lại mật khẩu'}
                </button>

                <p className="auth-switch" style={{ marginTop: 16 }}>
                  <Link href={routes.login}>← Quay lại đăng nhập</Link>
                </p>
              </form>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
