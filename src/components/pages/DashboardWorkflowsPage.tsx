import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import DashboardShell from '@/components/dashboard/DashboardShell';
import WorkflowPanel from '@/components/dashboard/WorkflowPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/dashboard.styles';

export default function DashboardWorkflowsPage() {
  const router = useRouter();
  const { user: authUser, loading: authLoading } = useAuth();
  const { user } = useDashboard();

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) router.replace(`${routes.login}?redirect=${routes.dashboardWorkflows}`);
  }, [authUser, authLoading, router]);

  if (authLoading || !authUser) return null;

  return (
    <>
      <Head>
        <title>GPUVietnam – Workflow</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <DashboardShell
        user={user}
        activeTab="workflows"
        title="Workflow"
        mainClassName="main-content main-content--workflows"
      >
        <WorkflowPanel />
      </DashboardShell>
    </>
  );
}
