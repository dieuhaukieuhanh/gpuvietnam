import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import {
  StorageUpgradeModal,
  type PlanGb,
  type PlanPrices,
} from '@/components/dashboard/StoragePanel';
import { useAuth } from '@/contexts/AuthContext';
import { routes } from '@/lib/routes';
import {
  BACKUP_PLANS,
  SSD_PLANS,
  isPlanBlocked,
} from '@/lib/storage-plans';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

type Props = {
  className?: string;
};

export default function StorageUpgradeCard({ className }: Props) {
  const router = useRouter();
  const { session } = useAuth();

  const [ssdPlanGb, setSsdPlanGb] = useState<PlanGb>(20);
  const [backupPlanGb, setBackupPlanGb] = useState<PlanGb>(20);
  const [selectedSsdGb, setSelectedSsdGb] = useState<PlanGb>(20);
  const [selectedBackupGb, setSelectedBackupGb] = useState<PlanGb>(20);
  const [ssdPrices, setSsdPrices] = useState<PlanPrices>({ ...SSD_PLANS });
  const [backupPrices, setBackupPrices] = useState<PlanPrices>({ ...BACKUP_PLANS });
  const [ssdUsed, setSsdUsed] = useState(0);
  const [backupUsed, setBackupUsed] = useState(0);
  const [showStorageUpgrade, setShowStorageUpgrade] = useState(false);
  const [confirmingStorageUpgrade, setConfirmingStorageUpgrade] = useState(false);

  const loadStoragePricing = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/storage-pricing');
      const data = await res.json();
      if (!res.ok) return;
      const active = ((data.items ?? []) as Array<{
        storage_type: string;
        size_gb: number;
        price_monthly: number;
        is_active: boolean;
      }>).filter((row) => row.is_active);
      const nextSsd: PlanPrices = {};
      const nextBackup: PlanPrices = {};
      for (const row of active) {
        const price = Number(row.price_monthly);
        if (row.storage_type === 'ssd') nextSsd[row.size_gb] = price;
        else if (row.storage_type === 'backup') nextBackup[row.size_gb] = price;
      }
      if (Object.keys(nextSsd).length > 0) setSsdPrices(nextSsd);
      if (Object.keys(nextBackup).length > 0) setBackupPrices(nextBackup);
    } catch {
      /* giữ fallback hardcode */
    }
  }, []);

  const loadStoragePlan = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch('/api/storage/plan', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) return;
      setSsdPlanGb(data.ssdPlanGb as PlanGb);
      setBackupPlanGb(data.backupPlanGb as PlanGb);
    } catch {
      /* giữ mặc định */
    }
  }, [session?.access_token]);

  const loadStorageUsage = useCallback(async () => {
    if (!session?.access_token || !session?.user?.id) return;
    try {
      const supabase = getSupabaseBrowser();
      const { data, error } = await supabase
        .from('storage_files')
        .select('storage_type, file_size_bytes')
        .eq('user_id', session.user.id);
      if (error) return;
      let ssd = 0;
      let backup = 0;
      for (const row of data ?? []) {
        const size = Number(row.file_size_bytes ?? 0);
        if (row.storage_type === 'ssd') ssd += size;
        else if (row.storage_type === 'backup') backup += size;
      }
      setSsdUsed(ssd);
      setBackupUsed(backup);
    } catch {
      /* bỏ qua */
    }
  }, [session?.access_token, session?.user?.id]);

  useEffect(() => {
    if (!session?.access_token) return;
    void loadStoragePlan();
    void loadStoragePricing();
    void loadStorageUsage();
  }, [session?.access_token, loadStoragePlan, loadStoragePricing, loadStorageUsage]);

  const openStorageUpgrade = useCallback(() => {
    void loadStoragePricing();
    void loadStorageUsage();
    setSelectedSsdGb(ssdPlanGb);
    setSelectedBackupGb(backupPlanGb);
    setShowStorageUpgrade(true);
  }, [ssdPlanGb, backupPlanGb, loadStoragePricing, loadStorageUsage]);

  const handleConfirmStorageUpgrade = useCallback(async () => {
    const blocked =
      isPlanBlocked(ssdUsed, selectedSsdGb) || isPlanBlocked(backupUsed, selectedBackupGb);
    const noChange = selectedSsdGb === ssdPlanGb && selectedBackupGb === backupPlanGb;
    if (blocked || noChange) return;

    if (!session?.access_token) {
      alert('Phiên đăng nhập hết hạn.');
      return;
    }
    setConfirmingStorageUpgrade(true);
    try {
      const res = await fetch('/api/storage/upgrade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ssdGb: selectedSsdGb, backupGb: selectedBackupGb }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Cập nhật gói bộ nhớ thất bại.');

      if (data.redirectUrl) {
        setShowStorageUpgrade(false);
        router.push(data.redirectUrl);
        return;
      }

      setSsdPlanGb(data.ssdPlanGb as PlanGb);
      setBackupPlanGb(data.backupPlanGb as PlanGb);
      setShowStorageUpgrade(false);
      void loadStoragePlan();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Cập nhật gói bộ nhớ thất bại.');
    } finally {
      setConfirmingStorageUpgrade(false);
    }
  }, [ssdUsed, backupUsed, selectedSsdGb, selectedBackupGb, ssdPlanGb, backupPlanGb, session?.access_token, router, loadStoragePlan]);

  const handleCleanUpStorage = useCallback(
    (_target: 'ssd' | 'backup') => {
      setShowStorageUpgrade(false);
      router.push(routes.dashboardStorage);
    },
    [router],
  );

  return (
    <>
      <article className={`wallet-service-card${className ? ` ${className}` : ''}`}>
        <div className="wallet-service-card-head">
          <span className="wallet-service-card-icon" aria-hidden>
            💾
          </span>
          <div>
            <h3 className="wallet-service-card-title">Nâng cấp bộ nhớ</h3>
            <p className="wallet-service-card-desc">
              Tăng dung lượng SSD và Backup lưu trữ trên nền tảng.
            </p>
          </div>
        </div>
        <div className="wallet-service-card-actions">
          <button
            type="button"
            className="wallet-service-card-link primary"
            onClick={openStorageUpgrade}
          >
            Nâng cấp
          </button>
        </div>
      </article>

      <StorageUpgradeModal
        open={showStorageUpgrade}
        ssdPlanGb={ssdPlanGb}
        backupPlanGb={backupPlanGb}
        selectedSsdGb={selectedSsdGb}
        selectedBackupGb={selectedBackupGb}
        ssdUsed={ssdUsed}
        backupUsed={backupUsed}
        ssdPrices={ssdPrices}
        backupPrices={backupPrices}
        confirming={confirmingStorageUpgrade}
        onClose={() => !confirmingStorageUpgrade && setShowStorageUpgrade(false)}
        onSelectSsd={setSelectedSsdGb}
        onSelectBackup={setSelectedBackupGb}
        onConfirm={() => void handleConfirmStorageUpgrade()}
        onCleanUp={handleCleanUpStorage}
      />
    </>
  );
}
