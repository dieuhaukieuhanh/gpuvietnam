import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import DashboardShell from '@/components/dashboard/DashboardShell';
import ModelLoraPanel from '@/components/dashboard/ModelLoraPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/dashboard.styles';

export default function DashboardModelsPage() {
  const router = useRouter();
  const { user: authUser, loading: authLoading } = useAuth();
  const { user } = useDashboard();

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) router.replace(`${routes.login}?redirect=${routes.dashboardModelLora}`);
  }, [authUser, authLoading, router]);

  if (authLoading || !authUser) return null;

  return (
    <>
      <Head>
        <title>GPUVietnam – Model &amp; LoRA</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <DashboardShell user={user} activeTab="models" title="Model & LoRA" mainClassName="main-content main-content--models">
        <ModelLoraPanel />
      </DashboardShell>
    </>
  );
}
