import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { routes } from '@/lib/routes';
import { planBytes } from '@/lib/storage-plans';

type PlanGb = 10 | 20 | 50 | 100;

type StorageFileRow = {
  storage_type: 'ssd' | 'backup';
  file_size_bytes: number;
};

function formatBytes(bytes: number) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / 1024 ** i;
  return `${value >= 10 || i === 0 ? value.toFixed(i >= 2 ? 1 : 0) : value.toFixed(1)} ${units[i]}`;
}

type StorageBarProps = {
  label: string;
  icon: string;
  used: number;
  total: number;
  variant: 'ssd' | 'backup';
};

function StorageBar({ label, icon, used, total, variant }: StorageBarProps) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  return (
    <div className="storage-item">
      <div className="storage-header">
        <span className="name">
          {icon} {label}
        </span>
        <span className="value">
          {formatBytes(used)} / {formatBytes(total)} · {pct}%
        </span>
      </div>
      <div className="storage-progress-track">
        <div
          className={`storage-progress-fill ${variant}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}

type RuntimeDiskMetrics = {
  used_gb: number;
  total_gb: number;
  percent: number;
};

type DashboardStorageSummaryCardProps = {
  accessToken: string | undefined;
  machineRunning?: boolean;
  runtimeDisk?: RuntimeDiskMetrics | null;
};

export default function DashboardStorageSummaryCard({
  accessToken,
  machineRunning = false,
  runtimeDisk = null,
}: DashboardStorageSummaryCardProps) {
  const [loading, setLoading] = useState(true);
  const [ssdPlanGb, setSsdPlanGb] = useState<PlanGb>(20);
  const [backupPlanGb, setBackupPlanGb] = useState<PlanGb>(20);
  const [ssdUsed, setSsdUsed] = useState(0);
  const [backupUsed, setBackupUsed] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = accessToken ?? session?.access_token;
      const userId = session?.user?.id;
      if (!token || !userId) return;

      const [planRes, filesRes] = await Promise.all([
        fetch('/api/storage/plan', { headers: { Authorization: `Bearer ${token}` } }),
        supabase.from('storage_files').select('storage_type, file_size_bytes').eq('user_id', userId),
      ]);

      if (planRes.ok) {
        const planData = await planRes.json();
        if (planData.ssdPlanGb) setSsdPlanGb(planData.ssdPlanGb as PlanGb);
        if (planData.backupPlanGb) setBackupPlanGb(planData.backupPlanGb as PlanGb);
      }

      if (!filesRes.error && filesRes.data) {
        const files = filesRes.data as StorageFileRow[];
        setSsdUsed(
          files
            .filter((f) => f.storage_type === 'ssd')
            .reduce((sum, f) => sum + Number(f.file_size_bytes), 0),
        );
        setBackupUsed(
          files
            .filter((f) => f.storage_type === 'backup')
            .reduce((sum, f) => sum + Number(f.file_size_bytes), 0),
        );
      }
    } catch {
      /* giữ giá trị mặc định */
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const ssdTotal = useMemo(() => planBytes(ssdPlanGb || 20), [ssdPlanGb]);
  const backupTotal = useMemo(() => planBytes(backupPlanGb || 20), [backupPlanGb]);
  const showRuntimeDisk = machineRunning && runtimeDisk != null;
  const runtimeDiskUsedBytes = showRuntimeDisk ? runtimeDisk.used_gb * 1024 ** 3 : 0;
  const runtimeDiskTotalBytes = showRuntimeDisk ? runtimeDisk.total_gb * 1024 ** 3 : 0;

  return (
    <div className="card dashboard-storage-summary-card">
      <div className="card-header">
        <span className="card-title">💾 BỘ NHỚ</span>
        <Link
          href={routes.dashboardStorage}
          style={{ fontSize: 12, color: 'var(--accent-blue)', textDecoration: 'none' }}
        >
          Quản lý →
        </Link>
      </div>

      <div className="dashboard-storage-summary-body">
      {loading ? (
        <p className="dashboard-stat-empty">Đang tải...</p>
      ) : (
        <>
          {showRuntimeDisk ? (
            <>
              <StorageBar
                label="SSD máy GPU"
                icon="⚡"
                used={runtimeDiskUsedBytes}
                total={runtimeDiskTotalBytes}
                variant="ssd"
              />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, marginBottom: 12 }}>
                Dung lượng thật trên instance Vast · {runtimeDisk.used_gb}GB / {runtimeDisk.total_gb}GB
              </p>
            </>
          ) : (
            <StorageBar label="SSD" icon="⚡" used={ssdUsed} total={ssdTotal} variant="ssd" />
          )}
          <StorageBar label="Backup" icon="💾" used={backupUsed} total={backupTotal} variant="backup" />
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
            Gói hiện tại: SSD {ssdPlanGb}GB · Backup {backupPlanGb}GB
          </p>
        </>
      )}
      </div>
    </div>
  );
}
