import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import DashboardShell from '@/components/dashboard/DashboardShell';
import StoragePanel, { type MachineLiveState } from '@/components/dashboard/StoragePanel';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/dashboard.styles';

type RuntimeDisk = {
  used_gb: number;
  total_gb: number;
  percent: number;
};

const STATUS_POLL_RUNNING_MS = 30_000;
const STATUS_POLL_BOOT_MS = 10_000;

function resolveMachineLiveState(status: string | undefined): MachineLiveState {
  if (status === 'running') return 'running';
  if (status === 'creating' || status === 'starting') return 'syncing';
  return 'offline';
}

export default function DashboardStoragePage() {
  const router = useRouter();
  const { user: authUser, loading: authLoading, session } = useAuth();
  const { user } = useDashboard();
  const [runtimeDisk, setRuntimeDisk] = useState<RuntimeDisk | null>(null);
  const [machineState, setMachineState] = useState<MachineLiveState>('syncing');

  const fetchMachineLive = useCallback(async () => {
    const token = session?.access_token;
    if (!token) {
      setMachineState('syncing');
      setRuntimeDisk(null);
      return;
    }

    try {
      const res = await fetch('/api/machines/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setMachineState('offline');
        setRuntimeDisk(null);
        return;
      }

      const nextState = resolveMachineLiveState(data.status);
      setMachineState(nextState);
      setRuntimeDisk(nextState === 'running' ? (data.metrics?.disk ?? null) : null);
    } catch {
      setMachineState('offline');
      setRuntimeDisk(null);
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) router.replace(`${routes.login}?redirect=${routes.dashboardStorage}`);
  }, [authUser, authLoading, router]);

  useEffect(() => {
    if (!session?.access_token) {
      setMachineState('syncing');
      setRuntimeDisk(null);
      return undefined;
    }

    void fetchMachineLive();
    const pollMs = machineState === 'running' ? STATUS_POLL_RUNNING_MS : STATUS_POLL_BOOT_MS;
    const id = window.setInterval(() => void fetchMachineLive(), pollMs);
    return () => window.clearInterval(id);
  }, [session?.access_token, machineState, fetchMachineLive]);

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
        <StoragePanel machineState={machineState} runtimeDisk={runtimeDisk} />
      </DashboardShell>
    </>
  );
}
