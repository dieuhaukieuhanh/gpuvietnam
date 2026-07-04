import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import DashboardShell from '@/components/dashboard/DashboardShell';
import StoragePanel from '@/components/dashboard/StoragePanel';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/dashboard.styles';

type RuntimeDisk = {
  used_gb: number;
  total_gb: number;
  percent: number;
};

const STATUS_POLL_MS = 30_000;

export default function DashboardStoragePage() {
  const router = useRouter();
  const { user: authUser, loading: authLoading, session } = useAuth();
  const { user, subscription } = useDashboard();
  const [runtimeDisk, setRuntimeDisk] = useState<RuntimeDisk | null>(null);

  const isMachineRunning = subscription?.server_status === 'online';

  const fetchRuntimeDisk = useCallback(async () => {
    const token = session?.access_token;
    if (!token || !isMachineRunning) {
      setRuntimeDisk(null);
      return;
    }

    try {
      const res = await fetch('/api/machines/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'running') {
        setRuntimeDisk(null);
        return;
      }
      setRuntimeDisk(data.metrics?.disk ?? null);
    } catch {
      setRuntimeDisk(null);
    }
  }, [session?.access_token, isMachineRunning]);

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) router.replace(`${routes.login}?redirect=${routes.dashboardStorage}`);
  }, [authUser, authLoading, router]);

  useEffect(() => {
    if (!isMachineRunning) {
      setRuntimeDisk(null);
      return undefined;
    }

    void fetchRuntimeDisk();
    const id = window.setInterval(() => void fetchRuntimeDisk(), STATUS_POLL_MS);
    return () => window.clearInterval(id);
  }, [isMachineRunning, fetchRuntimeDisk]);

  if (authLoading || !authUser) return null;

  return (
    <>
      <Head>
        <title>GPUVietnam – Bộ nhớ</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <DashboardShell
        user={user}
        activeTab="storage"
        title="Bộ nhớ"
        mainClassName="main-content main-content--storage"
      >
        <StoragePanel isMachineRunning={isMachineRunning} runtimeDisk={runtimeDisk} />
      </DashboardShell>
    </>
  );
}
