import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import DashboardShell from '@/components/dashboard/DashboardShell';
import MyPlanPanel from '@/components/dashboard/MyPlanPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { routes } from '@/lib/routes';
import { myPlanStyles } from '@/styles/pages/dashboard-goi-cua-toi.styles';
import { styles } from '@/styles/pages/dashboard.styles';

export default function DashboardGoiCuaToiPage() {
  const router = useRouter();
  const { user: authUser, loading: authLoading, session } = useAuth();
  const { user, subscription, billingView, refresh } = useDashboard();

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) router.replace(`${routes.login}?redirect=${routes.dashboardGoiCuaToi}`);
  }, [authUser, authLoading, router]);

  if (authLoading || !authUser) return null;

  return (
    <>
      <Head>
        <title>GPUVietnam – Gói của tôi</title>
        <style dangerouslySetInnerHTML={{ __html: styles + myPlanStyles }} />
      </Head>
      <DashboardShell user={user} activeTab="myPlan" title="Gói của tôi">
        <MyPlanPanel
          accessToken={session?.access_token}
          subscription={subscription}
          billingView={billingView}
          onBillingRefresh={refresh}
        />
      </DashboardShell>
    </>
  );
}
