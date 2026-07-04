import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';
import PublicHeader from '@/components/layout/PublicHeader';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/checkout-flow.styles';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;

    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    const supabase = getSupabaseBrowser();

    async function initSession() {
      const code = typeof router.query.code === 'string' ? router.query.code : null;

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!mounted) return;
        if (exchangeError) {
          setInvalidLink(true);
          return;
        }
        setReady(true);
        return;
      }

      const hash = window.location.hash;
      if (hash.includes('access_token=') || hash.includes('type=recovery')) {
        await supabase.auth.getSession();
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;
      if (session) {
        setReady(true);
        return;
      }

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, nextSession) => {
        if (!mounted) return;
        if (event === 'PASSWORD_RECOVERY' || nextSession) {
          setReady(true);
          setInvalidLink(false);
        }
      });
      unsubscribe = () => subscription.unsubscribe();

      window.setTimeout(() => {
        if (!mounted) return;
        setReady((current) => {
          if (!current) setInvalidLink(true);
          return current;
        });
      }, 5000);
    }

    initSession();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [router.isReady, router.query.code]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      setError('Mật khẩu tối thiểu 8 ký tự.');
      return;
    }
    if (password !== confirm) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const supabase = getSupabaseBrowser();
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(updateError.message || 'Không đặt lại được mật khẩu.');
        return;
      }

      await supabase.auth.signOut();
      setDone(true);
    } catch {
      setError('Đặt lại mật khẩu thất bại. Link có thể đã hết hạn.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>GPUVietnam – Đặt lại mật khẩu</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>

      <PublicHeader showNav={false} showCta={false} />

      <main className="main-content">
        <div className="container">
          <h2 className="section-title">Đặt lại mật khẩu</h2>
          <p className="section-subtitle">Nhập mật khẩu mới cho tài khoản của bạn</p>

          <div className="form-card">
            {done ? (
              <>
                <div className="success-msg">
                  Mật khẩu đã được cập nhật. Bạn có thể đăng nhập bằng mật khẩu mới.
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ marginTop: 16 }}
                  onClick={() => router.push(routes.login)}
                >
                  Đăng nhập ngay
                </button>
              </>
            ) : invalidLink ? (
              <>
                <div className="error-msg">
                  Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu link mới.
                </div>
                <Link href={routes.forgotPassword} className="btn btn-primary" style={{ marginTop: 16 }}>
                  Gửi lại link
                </Link>
              </>
            ) : !ready ? (
              <p className="form-note" style={{ textAlign: 'center' }}>
                Đang xác thực link từ email...
              </p>
            ) : (
              <form onSubmit={handleSubmit}>
                {error && <div className="error-msg">{error}</div>}

                <div className="form-group">
                  <label htmlFor="password">Mật khẩu mới *</label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="confirm">Xác nhận mật khẩu *</label>
                  <input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    minLength={8}
                    required
                  />
                </div>

                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? 'Đang lưu...' : 'Lưu mật khẩu mới'}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
