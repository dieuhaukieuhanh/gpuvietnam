import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import DashboardShell from '@/components/dashboard/DashboardShell';
import DashboardSettingsPage from '@/components/pages/DashboardSettingsPage';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { routes } from '@/lib/routes';
import { styles as dashboardStyles } from '@/styles/pages/dashboard.styles';
import { styles } from '@/styles/pages/dashboard-cai-dat.styles';

export default function DashboardCaiDatPage() {
  const router = useRouter();
  const { user: authUser, loading: authLoading } = useAuth();
  const { user, billingType, loading, error, refresh } = useDashboard();

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) router.replace(`${routes.login}?redirect=${routes.dashboardCaiDat}`);
  }, [authUser, authLoading, router]);

  if (authLoading || !authUser) return null;

  return (
    <>
      <Head>
        <title>GPUVietnam – Cài đặt</title>
        <style dangerouslySetInnerHTML={{ __html: dashboardStyles + styles }} />
      </Head>
      <DashboardShell user={user} activeTab="settings" title="Cài đặt" mainClassName="main-content settings-main">
        <DashboardSettingsPage
          user={user}
          billingType={billingType}
          loading={loading}
          error={error}
          onRefresh={refresh}
        />
      </DashboardShell>
    </>
  );
}
