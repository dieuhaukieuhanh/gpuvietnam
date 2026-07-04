import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import CheckoutAuthPanel from '@/components/auth/CheckoutAuthPanel';
import PublicHeader from '@/components/layout/PublicHeader';
import { useAuth } from '@/contexts/AuthContext';
import { orderToSearchParams, parseCheckoutOrder } from '@/lib/checkout-order';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/checkout-flow.styles';

export default function CheckoutPage() {
  const router = useRouter();
  const { user, session, loading } = useAuth();
  const [trialState, setTrialState] = useState<'idle' | 'activating' | 'done' | 'error'>('idle');
  const [trialError, setTrialError] = useState('');

  const trial = router.query.trial === 'true';
  const mode = router.query.mode as string | undefined;
  const workstation = router.query.workstation as string | undefined;
  const env = router.query.env as string | undefined;
  const icon = router.query.icon as string | undefined;
  const desc = router.query.desc as string | undefined;

  const activateTrial = useCallback(async () => {
    if (!session?.access_token) return;
    setTrialState('activating');
    setTrialError('');

    try {
      const response = await fetch('/api/trial/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          env: env ?? workstation,
          icon,
          desc,
          workstation,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setTrialError(result.error ?? 'Không kích hoạt được dùng thử.');
        setTrialState('error');
        return;
      }
      setTrialState('done');
    } catch {
      setTrialError('Không kích hoạt được dùng thử.');
      setTrialState('error');
    }
  }, [session?.access_token, env, workstation, icon, desc]);

  useEffect(() => {
    if (!router.isReady || loading) return;

    const order = parseCheckoutOrder(router.query);
    if (user && order && !trial) {
      const params = orderToSearchParams({
        ...order,
        email: user.email,
        phone: (user.user_metadata?.phone as string) ?? order.phone,
      });
      router.replace(`${routes.checkoutPlan}?${params.toString()}`);
    }
  }, [router, user, loading, trial]);

  useEffect(() => {
    if (!user || !trial || !session?.access_token) return;
    if (trialState !== 'idle') return;
    activateTrial();
  }, [user, trial, session?.access_token, trialState, activateTrial]);

  if (!router.isReady || loading) {
    return (
      <>
        <Head>
          <title>GPUVietnam – Checkout</title>
          <style dangerouslySetInnerHTML={{ __html: styles }} />
        </Head>
        <main className="main-content">
          <div className="container">
            <p className="section-subtitle">Đang tải...</p>
          </div>
        </main>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Head>
          <title>GPUVietnam – Checkout</title>
          <style dangerouslySetInnerHTML={{ __html: styles }} />
        </Head>
        <PublicHeader showNav={false} showCta={false} />
        <main className="main-content">
          <div className="container">
            <h2 className="section-title">Đăng ký / Đăng nhập</h2>
            <p className="section-subtitle">
              Hoàn tất xác thực để kích hoạt dùng thử 3 giờ miễn phí
            </p>
            <CheckoutAuthPanel
              trial={trial}
              workstation={workstation}
              onAuthenticated={() => router.reload()}
            />
          </div>
        </main>
      </>
    );
  }

  if (trial) {
    const envLabel = workstation ?? env ?? 'ComfyUI';

    return (
      <>
        <Head>
          <title>GPUVietnam – Dùng thử miễn phí</title>
          <style dangerouslySetInnerHTML={{ __html: styles }} />
        </Head>
        <PublicHeader showNav={false} showCta={false} />
        <main className="main-content">
          <div className="container">
            <div className="form-card" style={{ textAlign: 'center' }}>
              <h2 className="section-title">🎁 Dùng thử 3 giờ miễn phí</h2>
              <p className="section-subtitle">
                {mode === 'login' ? 'Đăng nhập thành công!' : 'Đăng ký & xác thực OTP thành công!'}
              </p>
              <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                Môi trường: <strong>{decodeURIComponent(envLabel)}</strong>
              </p>

              {trialState === 'activating' && (
                <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>⏳ Đang kích hoạt gói dùng thử...</p>
              )}

              {trialState === 'error' && (
                <div className="error-msg" style={{ marginBottom: 16 }}>
                  {trialError}
                  <br />
                  <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={activateTrial}>
                    Thử lại
                  </button>
                </div>
              )}

              {trialState === 'done' && (
                <p style={{ marginBottom: 24, fontSize: 14, color: 'var(--accent-green)' }}>
                  ✅ Đã kích hoạt 3 giờ GPU miễn phí!
                </p>
              )}

              {(trialState === 'done' || trialState === 'error') && (
                <Link href={routes.dashboard} className="btn btn-primary">
                  Vào Dashboard →
                </Link>
              )}
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>GPUVietnam – Checkout</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <main className="main-content">
        <div className="container">
          <p className="section-subtitle">Đang chuyển đến trang thanh toán...</p>
        </div>
      </main>
    </>
  );
}
