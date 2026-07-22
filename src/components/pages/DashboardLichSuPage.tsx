import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import DashboardShell from '@/components/dashboard/DashboardShell';
import HistoryPanel from '@/components/dashboard/HistoryPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/dashboard.styles';

export default function DashboardLichSuPage() {
  const router = useRouter();
  const { user: authUser, loading: authLoading, session } = useAuth();
  const { user } = useDashboard();

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) router.replace(`${routes.login}?redirect=${routes.dashboardLichSu}`);
  }, [authUser, authLoading, router]);

  if (authLoading || !authUser) return null;

  return (
    <>
      <Head>
        <title>GPUVietnam – Lịch sử phiên</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <DashboardShell user={user} activeTab="history" title="Lịch sử phiên">
        <HistoryPanel accessToken={session?.access_token} />
        {/* CP Job history ẩn với KH — cùng lý do với DashboardJobsCard */}
      </DashboardShell>
    </>
  );
}
