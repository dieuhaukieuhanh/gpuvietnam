import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DashboardOverview from '@/components/dashboard/DashboardOverview';
import DashboardShell from '@/components/dashboard/DashboardShell';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/dashboard.styles';

export default function DashboardPage() {
  const router = useRouter();
  const { user: authUser, loading: authLoading } = useAuth();
  const { user, subscription, loading, error, refresh, remaining } = useDashboard();
  const [showPending, setShowPending] = useState(false);
  const [showActivated, setShowActivated] = useState(false);

  useEffect(() => {
    if (router.query.pending === '1') {
      setShowPending(true);
      router.replace(routes.dashboard, undefined, { shallow: true });
    }
  }, [router]);

  useEffect(() => {
    if (router.query.activated === '1') {
      setShowActivated(true);
      router.replace(routes.dashboard, undefined, { shallow: true });
    }
  }, [router]);

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) router.replace(`${routes.login}?redirect=${routes.dashboard}`);
  }, [authUser, authLoading, router]);

  if (authLoading || !authUser) {
    return (
      <>
        <Head>
          <title>GPUVietnam – Dashboard</title>
          <style dangerouslySetInnerHTML={{ __html: styles }} />
        </Head>
        <div style={{ padding: 48, textAlign: 'center', color: '#9898A8' }}>Đang kiểm tra phiên...</div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>GPUVietnam – Dashboard</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <DashboardShell user={user} activeTab="dashboard">
        {showPending && (
          <div className="alert-card warning" style={{ display: 'flex', marginBottom: 20 }}>
            <span className="alert-icon">📨</span>
            <div className="alert-content">
              <div className="alert-title">Đã gửi yêu cầu thanh toán!</div>
              <div className="alert-desc">
                Admin sẽ xác nhận chuyển khoản thật trước khi kích hoạt GPU. Theo dõi trạng thái
                bên dưới.
              </div>
            </div>
            <button type="button" className="alert-close" onClick={() => setShowPending(false)}>
              ✕
            </button>
          </div>
        )}
        {showActivated && (
          <div className="alert-card" style={{ display: 'flex', marginBottom: 20, borderColor: 'var(--accent-green)' }}>
            <span className="alert-icon">✅</span>
            <div className="alert-content">
              <div className="alert-title">Gói GPU đã được kích hoạt!</div>
              <div className="alert-desc">Máy đang khởi tạo — theo dõi trạng thái bên dưới.</div>
            </div>
            <button type="button" className="alert-close" onClick={() => setShowActivated(false)}>
              ✕
            </button>
          </div>
        )}
        <DashboardOverview
          user={user}
          subscription={subscription}
          dashboardRemaining={remaining}
          loading={loading}
          error={error}
          onRefresh={refresh}
        />
      </DashboardShell>
    </>
  );
}
