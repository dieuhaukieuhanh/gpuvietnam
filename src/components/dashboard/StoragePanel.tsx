import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useIsMobile } from '@/hooks/useIsMobile';
import { routes } from '@/lib/routes';
import {
  BACKUP_PLANS,
  SSD_PLANS,
  isPlanBlocked,
  planBytes,
} from '@/lib/storage-plans';

export type PlanPrices = Record<number, number>;

export type StorageFileRecord = {
  id: string;
  user_id: string;
  file_name: string;
  file_path: string;
  file_size_bytes: number;
  storage_type: 'ssd' | 'backup';
  category: 'model' | 'output' | 'workflow' | 'custom_node';
  created_at: string;
  updated_at: string;
};

export type MachineLiveState = 'syncing' | 'running' | 'offline';

type StoragePanelProps = {
  machineState?: MachineLiveState;
  runtimeDisk?: {
    used_gb: number;
    total_gb: number;
    percent: number;
  } | null;
};

export type PlanGb = 10 | 20 | 50 | 100;

type AutoBackupLog = {
  id: number;
  machineId: string | null;
  reason: string;
  reasonLabel: string;
  status: string;
  errorMessage: string | null;
  sizeBytes: number;
  createdAt: string;
};

const PLAN_GB_OPTIONS: PlanGb[] = [10, 20, 50, 100];

const FOLDER_CATEGORIES: Array<{
  category: StorageFileRecord['category'];
  label: string;
  icon: string;
}> = [
  { category: 'model', label: 'models', icon: '📁' },
  { category: 'output', label: 'outputs', icon: '📁' },
  { category: 'workflow', label: 'workflows', icon: '📁' },
  { category: 'custom_node', label: 'custom_nodes', icon: '📁' },
];

function formatBytes(bytes: number) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / 1024 ** i;
  return `${value >= 10 || i === 0 ? value.toFixed(i >= 2 ? 1 : 0) : value.toFixed(1)} ${units[i]}`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatGiB(bytes: number) {
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

export function formatVndShort(amount: number) {
  if (amount === 0) return '0đ';
  const formatted = new Intl.NumberFormat('vi-VN').format(Math.abs(amount));
  if (amount > 0) return `+${formatted}đ`;
  return `-${formatted}đ`;
}

type ProgressBarProps = {
  used: number;
  total: number;
  variant: 'ssd' | 'backup';
};

function ProgressBar({ used, total, variant }: ProgressBarProps) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  return (
    <div className="storage-progress-wrap">
      <div className="storage-progress-meta">
        <span>
          Đã dùng <strong>{formatBytes(used)}</strong> / {formatBytes(total)}
        </span>
        <span>{pct}%</span>
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

type StoragePlanZoneProps = {
  title: string;
  variant: 'ssd' | 'backup';
  used: number;
  currentGb: PlanGb;
  selectedGb: PlanGb;
  prices: PlanPrices;
  confirming: boolean;
  onSelect: (gb: PlanGb) => void;
  onCleanUp: () => void;
};

function StoragePlanZone({
  title,
  variant,
  used,
  currentGb,
  selectedGb,
  prices,
  confirming,
  onSelect,
  onCleanUp,
}: StoragePlanZoneProps) {
  return (
    <div className={`storage-upgrade-zone storage-upgrade-zone-${variant}`}>
      <h4 className="storage-upgrade-zone-title">{title}</h4>
      <ProgressBar used={used} total={planBytes(currentGb)} variant={variant} />

      <fieldset className="storage-upgrade-plans">
        <legend className="storage-upgrade-label">Chọn dung lượng</legend>
        {PLAN_GB_OPTIONS.filter((gb) => prices[gb] != null).map((gb) => {
          const blocked = isPlanBlocked(used, gb);
          const isCurrent = gb === currentGb;

          return (
            <div key={gb} className={`storage-upgrade-option-row${blocked ? ' blocked' : ''}`}>
              <label
                className={`storage-upgrade-option${selectedGb === gb ? ' selected' : ''}${blocked ? ' is-blocked' : ''}`}
              >
                <input
                  type="radio"
                  name={`storagePlan-${variant}`}
                  value={gb}
                  checked={selectedGb === gb}
                  onChange={() => onSelect(gb)}
                  disabled={confirming || blocked}
                />
                <span className="storage-upgrade-option-main">
                  <strong>
                    {isCurrent && <span className="storage-current-dot" aria-hidden>● </span>}
                    {gb}GB
                  </strong>
                  <span className="storage-upgrade-option-price">
                    {new Intl.NumberFormat('vi-VN').format(prices[gb])} đ/tháng
                  </span>
                </span>
                {isCurrent && (
                  <span className="storage-upgrade-option-tag" aria-label="Gói hiện tại">
                    Hiện tại
                  </span>
                )}
              </label>
              {blocked && (
                <>
                  <p className="storage-option-blocked-msg">
                    Không thể hạ cấp xuống {gb}GB — đang dùng {formatGiB(used)}
                  </p>
                  <button type="button" className="btn btn-sm storage-clean-mini" onClick={onCleanUp}>
                    Dọn dẹp
                  </button>
                </>
              )}
            </div>
          );
        })}
      </fieldset>
    </div>
  );
}

type StorageUpgradeModalProps = {
  open: boolean;
  ssdPlanGb: PlanGb;
  backupPlanGb: PlanGb;
  selectedSsdGb: PlanGb;
  selectedBackupGb: PlanGb;
  ssdUsed: number;
  backupUsed: number;
  ssdPrices: PlanPrices;
  backupPrices: PlanPrices;
  confirming: boolean;
  onClose: () => void;
  onSelectSsd: (gb: PlanGb) => void;
  onSelectBackup: (gb: PlanGb) => void;
  onConfirm: () => void;
  onCleanUp: (target: 'ssd' | 'backup') => void;
};

export function StorageUpgradeModal({
  open,
  ssdPlanGb,
  backupPlanGb,
  selectedSsdGb,
  selectedBackupGb,
  ssdUsed,
  backupUsed,
  ssdPrices,
  backupPrices,
  confirming,
  onClose,
  onSelectSsd,
  onSelectBackup,
  onConfirm,
  onCleanUp,
}: StorageUpgradeModalProps) {
  const ssdPriceDiff = (ssdPrices[selectedSsdGb] ?? 0) - (ssdPrices[ssdPlanGb] ?? 0);
  const backupPriceDiff = (backupPrices[selectedBackupGb] ?? 0) - (backupPrices[backupPlanGb] ?? 0);
  const totalPriceDiff = ssdPriceDiff + backupPriceDiff;

  const ssdBlocked = isPlanBlocked(ssdUsed, selectedSsdGb);
  const backupBlocked = isPlanBlocked(backupUsed, selectedBackupGb);
  const noChange = selectedSsdGb === ssdPlanGb && selectedBackupGb === backupPlanGb;

  const ssdSummary =
    selectedSsdGb === ssdPlanGb
      ? `${ssdPlanGb}GB (giữ nguyên)`
      : `${ssdPlanGb}GB → ${selectedSsdGb}GB (${formatVndShort(ssdPriceDiff)})`;

  const backupSummary =
    selectedBackupGb === backupPlanGb
      ? `${backupPlanGb}GB (giữ nguyên)`
      : `${backupPlanGb}GB → ${selectedBackupGb}GB (${formatVndShort(backupPriceDiff)})`;

  return (
    <div
      className={`modal-overlay storage-upgrade-overlay${open ? ' active' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !confirming) onClose();
      }}
      role="presentation"
    >
      <div
        className="modal storage-upgrade-modal"
        role="dialog"
        aria-labelledby="storageUpgradeTitle"
        aria-modal="true"
      >
        <button
          type="button"
          className="close-btn"
          onClick={onClose}
          disabled={confirming}
          aria-label="Đóng"
        >
          ✕
        </button>

        <h3 id="storageUpgradeTitle">📈 Nâng cấp / Hạ cấp Bộ nhớ</h3>

        <div className="storage-upgrade-columns">
          <StoragePlanZone
            title="⚡ SSD dùng ngay"
            variant="ssd"
            used={ssdUsed}
            currentGb={ssdPlanGb}
            selectedGb={selectedSsdGb}
            prices={ssdPrices}
            confirming={confirming}
            onSelect={onSelectSsd}
            onCleanUp={() => onCleanUp('ssd')}
          />
          <StoragePlanZone
            title="☁️ Backup"
            variant="backup"
            used={backupUsed}
            currentGb={backupPlanGb}
            selectedGb={selectedBackupGb}
            prices={backupPrices}
            confirming={confirming}
            onSelect={onSelectBackup}
            onCleanUp={() => onCleanUp('backup')}
          />
        </div>

        <div className="storage-upgrade-summary">
          <div className="storage-upgrade-summary-divider" />
          <p>
            <span>SSD:</span> {ssdSummary}
          </p>
          <p>
            <span>Backup:</span> {backupSummary}
          </p>
          <p className="storage-upgrade-summary-total">
            💰 Tổng thay đổi:{' '}
            <strong>
              {totalPriceDiff === 0 ? '0đ/tháng' : `${formatVndShort(totalPriceDiff)}/tháng`}
            </strong>
          </p>
        </div>

        <div className="storage-upgrade-actions">
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose} disabled={confirming}>
            Hủy
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={onConfirm}
            disabled={confirming || ssdBlocked || backupBlocked || noChange}
          >
            {confirming ? 'Đang xử lý...' : 'Xác nhận thay đổi'}
          </button>
        </div>
      </div>
    </div>
  );
}

type TransferDirection = 'ssd-to-backup' | 'backup-to-ssd';

type StorageTransferModalProps = {
  open: boolean;
  transferring: boolean;
  direction: TransferDirection;
  ssdFiles: StorageFileRecord[];
  backupFiles: StorageFileRecord[];
  ssdUsed: number;
  backupUsed: number;
  ssdTotalBytes: number;
  backupTotalBytes: number;
  onClose: () => void;
  onDirectionChange: (direction: TransferDirection) => void;
  onConfirm: () => void;
};

function StorageTransferModal({
  open,
  transferring,
  direction,
  ssdFiles,
  backupFiles,
  ssdUsed,
  backupUsed,
  ssdTotalBytes,
  backupTotalBytes,
  onClose,
  onDirectionChange,
  onConfirm,
}: StorageTransferModalProps) {
  const ssdToBackupBytes = ssdFiles.reduce((sum, f) => sum + Number(f.file_size_bytes), 0);
  const backupToSsdBytes = backupFiles.reduce((sum, f) => sum + Number(f.file_size_bytes), 0);
  const ssdToBackupOk = ssdFiles.length > 0 && backupUsed + ssdToBackupBytes <= backupTotalBytes;
  const backupToSsdOk = backupFiles.length > 0 && ssdUsed + backupToSsdBytes <= ssdTotalBytes;

  const sourceFiles = direction === 'ssd-to-backup' ? ssdFiles : backupFiles;
  const sourceBytes =
    direction === 'ssd-to-backup' ? ssdToBackupBytes : backupToSsdBytes;
  const canConfirm =
    direction === 'ssd-to-backup' ? ssdToBackupOk : backupToSsdOk;

  return (
    <div
      className={`modal-overlay storage-upgrade-overlay${open ? ' active' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !transferring) onClose();
      }}
      role="presentation"
    >
      <div
        className="modal storage-transfer-modal"
        role="dialog"
        aria-labelledby="storageTransferTitle"
        aria-modal="true"
      >
        <button
          type="button"
          className="close-btn"
          onClick={onClose}
          disabled={transferring}
          aria-label="Đóng"
        >
          ✕
        </button>

        <h3 id="storageTransferTitle">Chuyển dữ liệu SSD ⇄ Backup</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          Chọn hướng chuyển. Toàn bộ file ở nguồn sẽ được chuyển sang kho đích (không sao chép).
        </p>

        <div className="storage-transfer-directions">
          <label
            className={`storage-transfer-option${direction === 'ssd-to-backup' ? ' selected' : ''}${!ssdToBackupOk ? ' disabled' : ''}`}
          >
            <input
              type="radio"
              name="transferDirection"
              checked={direction === 'ssd-to-backup'}
              disabled={transferring || !ssdToBackupOk}
              onChange={() => onDirectionChange('ssd-to-backup')}
            />
            <span className="storage-transfer-option-main">
              <strong>⚡ SSD → ☁️ Backup</strong>
              <span>
                Chuyển toàn bộ SSD sang Backup · {ssdFiles.length} mục · {formatBytes(ssdToBackupBytes)}
                {!ssdToBackupOk &&
                  (ssdFiles.length === 0
                    ? ' · SSD trống'
                    : ` · Backup thiếu ${formatBytes(backupUsed + ssdToBackupBytes - backupTotalBytes)}`)}
              </span>
            </span>
          </label>

          <label
            className={`storage-transfer-option${direction === 'backup-to-ssd' ? ' selected' : ''}${!backupToSsdOk ? ' disabled' : ''}`}
          >
            <input
              type="radio"
              name="transferDirection"
              checked={direction === 'backup-to-ssd'}
              disabled={transferring || !backupToSsdOk}
              onChange={() => onDirectionChange('backup-to-ssd')}
            />
            <span className="storage-transfer-option-main">
              <strong>☁️ Backup → ⚡ SSD</strong>
              <span>
                Chuyển toàn bộ Backup lên SSD · {backupFiles.length} mục · {formatBytes(backupToSsdBytes)}
                {!backupToSsdOk &&
                  (backupFiles.length === 0
                    ? ' · Backup trống'
                    : ` · SSD thiếu ${formatBytes(ssdUsed + backupToSsdBytes - ssdTotalBytes)}`)}
              </span>
            </span>
          </label>
        </div>

        {canConfirm && (
          <div className="storage-transfer-summary">
            Sẽ chuyển <strong>{sourceFiles.length}</strong> mục ({formatBytes(sourceBytes)}) từ{' '}
            <strong>{direction === 'ssd-to-backup' ? 'SSD' : 'Backup'}</strong> sang{' '}
            <strong>{direction === 'ssd-to-backup' ? 'Backup' : 'SSD'}</strong>.
          </div>
        )}

        <div className="storage-transfer-actions">
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose} disabled={transferring}>
            Hủy
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={onConfirm}
            disabled={transferring || !canConfirm}
          >
            {transferring ? 'Đang chuyển...' : 'Xác nhận chuyển'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StoragePanel({
  machineState = 'syncing',
  runtimeDisk = null,
}: StoragePanelProps) {
  const isMachineRunning = machineState === 'running';
  const { isMobile } = useIsMobile();
  const router = useRouter();
  const ssdSectionRef = useRef<HTMLElement>(null);
  const backupSectionRef = useRef<HTMLElement>(null);

  const [files, setFiles] = useState<StorageFileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferDirection, setTransferDirection] = useState<TransferDirection>('ssd-to-backup');
  const [cleaning, setCleaning] = useState(false);
  const [ssdPlanGb, setSsdPlanGb] = useState<PlanGb>(20);
  const [backupPlanGb, setBackupPlanGb] = useState<PlanGb>(20);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [selectedSsdGb, setSelectedSsdGb] = useState<PlanGb>(20);
  const [selectedBackupGb, setSelectedBackupGb] = useState<PlanGb>(20);
  const [confirmingPlan, setConfirmingPlan] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [highlightSection, setHighlightSection] = useState<'ssd' | 'backup' | null>(null);
  const [hasPendingUpgrade, setHasPendingUpgrade] = useState(false);
  const [rejectedNote, setRejectedNote] = useState<string | null>(null);
  const [ssdPrices, setSsdPrices] = useState<PlanPrices>({ ...SSD_PLANS });
  const [backupPrices, setBackupPrices] = useState<PlanPrices>({ ...BACKUP_PLANS });
  const [autoBackupLogs, setAutoBackupLogs] = useState<AutoBackupLog[]>([]);
  const [loadingAutoBackups, setLoadingAutoBackups] = useState(false);
  const [restoringLogId, setRestoringLogId] = useState<number | null>(null);

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

  const loadAutoBackupLogs = useCallback(async () => {
    setLoadingAutoBackups(true);
    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setAutoBackupLogs([]);
        return;
      }

      const res = await fetch('/api/user/backup-logs?limit=5', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setAutoBackupLogs([]);
        return;
      }

      setAutoBackupLogs((data.items ?? []) as AutoBackupLog[]);
    } catch {
      setAutoBackupLogs([]);
    } finally {
      setLoadingAutoBackups(false);
    }
  }, []);

  const ssdTotalBytes = planBytes(ssdPlanGb);
  const backupTotalBytes = planBytes(backupPlanGb);

  const loadStoragePlan = useCallback(async () => {
    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch('/api/storage/plan', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) return;

      setSsdPlanGb(data.ssdPlanGb as PlanGb);
      setBackupPlanGb(data.backupPlanGb as PlanGb);
      setHasPendingUpgrade(Boolean(data.pendingUpgrade));
      setRejectedNote(data.rejectedUpgrade?.admin_note ?? null);
    } catch {
      /* giữ giá trị mặc định */
    }
  }, []);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        setError('Vui lòng đăng nhập để xem bộ nhớ.');
        setFiles([]);
        return;
      }

      const { data, error: queryError } = await supabase
        .from('storage_files')
        .select('*')
        .eq('user_id', session.user.id)
        .order('storage_type', { ascending: true })
        .order('updated_at', { ascending: false });

      if (queryError) throw queryError;
      setFiles((data ?? []) as StorageFileRecord[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không tải được dữ liệu bộ nhớ.';
      setError(message);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles();
    loadStoragePlan();
    loadStoragePricing();
    loadAutoBackupLogs();
  }, [loadFiles, loadStoragePlan, loadStoragePricing, loadAutoBackupLogs]);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.paid === '1') {
      setToastMessage('Thanh toán thành công! Gói bộ nhớ đã được cập nhật.');
      loadStoragePlan();
      router.replace(routes.dashboardStorage, undefined, { shallow: true });
    } else if (router.query.pending === '1') {
      setToastMessage('Đã ghi nhận chuyển khoản. Đang chờ Admin duyệt.');
      loadStoragePlan();
      router.replace(routes.dashboardStorage, undefined, { shallow: true });
    }
  }, [router.isReady, router.query.paid, router.query.pending, loadStoragePlan, router]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const ssdFiles = useMemo(
    () => files.filter((f) => f.storage_type === 'ssd'),
    [files],
  );

  const backupFiles = useMemo(
    () => files.filter((f) => f.storage_type === 'backup'),
    [files],
  );

  const ssdUsed = useMemo(
    () => ssdFiles.reduce((sum, f) => sum + Number(f.file_size_bytes), 0),
    [ssdFiles],
  );

  const backupUsed = useMemo(
    () => backupFiles.reduce((sum, f) => sum + Number(f.file_size_bytes), 0),
    [backupFiles],
  );

  const ssdFolders = useMemo(() => {
    return FOLDER_CATEGORIES.map(({ category, label, icon }) => {
      const items = ssdFiles.filter((f) => f.category === category);
      const size = items.reduce((sum, f) => sum + Number(f.file_size_bytes), 0);
      const lastModified =
        items.length > 0
          ? items.reduce(
              (latest, f) => (f.updated_at > latest ? f.updated_at : latest),
              items[0].updated_at,
            )
          : null;

      return { category, label, icon, size, lastModified, count: items.length };
    });
  }, [ssdFiles]);

  const handleCleanTemp = async () => {
    if (!isMachineRunning) {
      alert('Máy đang tắt — không thể dọn dẹp SSD.');
      return;
    }

    const tempFiles = ssdFiles.filter(
      (f) =>
        f.file_name.toLowerCase().includes('temp') || f.file_path.toLowerCase().includes('/temp/'),
    );

    if (tempFiles.length === 0) {
      alert('Không có file tạm cần dọn dẹp.');
      return;
    }

    if (!confirm(`Xóa ${tempFiles.length} file tạm trên SSD?`)) return;

    setCleaning(true);
    try {
      const supabase = getSupabaseBrowser();
      const ids = tempFiles.map((f) => f.id);
      const { error: deleteError } = await supabase.from('storage_files').delete().in('id', ids);
      if (deleteError) throw deleteError;
      setFiles((prev) => prev.filter((f) => !ids.includes(f.id)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Dọn dẹp thất bại.');
    } finally {
      setCleaning(false);
    }
  };

  const handleOpenTransferModal = () => {
    if (!isMachineRunning) {
      alert('Máy đang tắt — bật máy GPU trước khi chuyển dữ liệu.');
      return;
    }

    if (ssdFiles.length === 0 && backupFiles.length === 0) {
      alert('Không có dữ liệu để chuyển giữa SSD và Backup.');
      return;
    }

    setTransferDirection(ssdFiles.length > 0 ? 'ssd-to-backup' : 'backup-to-ssd');
    setShowTransferModal(true);
  };

  const handleConfirmTransfer = async () => {
    if (!isMachineRunning) {
      alert('Máy đang tắt — không thể chuyển dữ liệu.');
      return;
    }

    const sourceFiles = transferDirection === 'ssd-to-backup' ? ssdFiles : backupFiles;
    const targetType = transferDirection === 'ssd-to-backup' ? 'backup' : 'ssd';
    const sourceLabel = transferDirection === 'ssd-to-backup' ? 'SSD' : 'Backup';
    const targetLabel = transferDirection === 'ssd-to-backup' ? 'Backup' : 'SSD';

    if (sourceFiles.length === 0) {
      alert(`${sourceLabel} không có dữ liệu để chuyển.`);
      return;
    }

    const transferBytes = sourceFiles.reduce((sum, f) => sum + Number(f.file_size_bytes), 0);
    const targetUsed = transferDirection === 'ssd-to-backup' ? backupUsed : ssdUsed;
    const targetTotal =
      transferDirection === 'ssd-to-backup' ? backupTotalBytes : ssdTotalBytes;

    if (targetUsed + transferBytes > targetTotal) {
      alert(`${targetLabel} không đủ dung lượng trống.`);
      return;
    }

    setTransferring(true);
    try {
      const supabase = getSupabaseBrowser();
      const ids = sourceFiles.map((f) => f.id);
      const { error: updateError } = await supabase
        .from('storage_files')
        .update({ storage_type: targetType })
        .in('id', ids);

      if (updateError) throw updateError;

      setFiles((prev) =>
        prev.map((f) => (ids.includes(f.id) ? { ...f, storage_type: targetType } : f)),
      );
      setShowTransferModal(false);
      setToastMessage(
        `Đã chuyển ${sourceFiles.length} mục từ ${sourceLabel} sang ${targetLabel}.`,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Chuyển dữ liệu thất bại.');
    } finally {
      setTransferring(false);
    }
  };

  const handleUploadBackup = () => {
    alert('Upload lên Backup sẽ có trong bản cập nhật tiếp theo.');
  };

  const handleBackupDownload = (file: StorageFileRecord) => {
    alert(`Tải xuống "${file.file_name}" sẽ được kết nối storage thật sau.`);
  };

  const handleBackupRestore = async (file: StorageFileRecord) => {
    if (!isMachineRunning) {
      alert('Máy đang tắt — bật máy GPU trước khi khôi phục lên SSD.');
      return;
    }

    const fileBytes = Number(file.file_size_bytes);
    if (ssdUsed + fileBytes > ssdTotalBytes) {
      alert('SSD không đủ dung lượng để khôi phục file này.');
      return;
    }

    if (!confirm(`Khôi phục "${file.file_name}" từ Backup lên SSD?`)) return;

    setBusyId(file.id);
    try {
      const supabase = getSupabaseBrowser();
      const { error: updateError } = await supabase
        .from('storage_files')
        .update({ storage_type: 'ssd' })
        .eq('id', file.id);

      if (updateError) throw updateError;
      setFiles((prev) =>
        prev.map((f) => (f.id === file.id ? { ...f, storage_type: 'ssd' as const } : f)),
      );
      setToastMessage(`Đã khôi phục "${file.file_name}" lên SSD.`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Khôi phục thất bại.');
    } finally {
      setBusyId(null);
    }
  };

  const handleBackupDelete = async (file: StorageFileRecord) => {
    if (!confirm(`Xóa "${file.file_name}" khỏi Backup?`)) return;

    setBusyId(file.id);
    try {
      const supabase = getSupabaseBrowser();
      const { error: deleteError } = await supabase.from('storage_files').delete().eq('id', file.id);
      if (deleteError) throw deleteError;
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Xóa file thất bại.');
    } finally {
      setBusyId(null);
    }
  };

  const handleAutoBackupRestore = async (log: AutoBackupLog) => {
    if (!isMachineRunning) {
      alert('Máy đang tắt — bật máy GPU trước khi khôi phục dữ liệu lên ComfyUI.');
      return;
    }

    if (log.status === 'failed') {
      alert('Bản backup này thất bại, không thể khôi phục.');
      return;
    }

    if (!confirm(`Khôi phục dữ liệu backup (${log.reasonLabel}) lên máy đang chạy?`)) return;

    setRestoringLogId(log.id);
    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Phiên đăng nhập hết hạn.');

      const res = await fetch('/api/user/backup-restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ logId: log.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Khôi phục thất bại.');

      setToastMessage(data.message ?? 'Đã khôi phục dữ liệu lên máy.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Khôi phục thất bại.');
    } finally {
      setRestoringLogId(null);
    }
  };

  const autoBackupStatusLabel = (status: string) => {
    if (status === 'completed') return '✅ Thành công';
    if (status === 'partial') return '⚠️ Một phần';
    return '❌ Thất bại';
  };

  const openUpgradeModal = () => {
    loadStoragePricing();
    setSelectedSsdGb(ssdPlanGb);
    setSelectedBackupGb(backupPlanGb);
    setShowUpgradeModal(true);
  };

  const scrollToStorageSection = (target: 'ssd' | 'backup') => {
    setShowUpgradeModal(false);
    setHighlightSection(target);
    window.setTimeout(() => setHighlightSection(null), 2000);
    window.requestAnimationFrame(() => {
      const ref = target === 'ssd' ? ssdSectionRef : backupSectionRef;
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleConfirmPlanChange = async () => {
    const blocked =
      isPlanBlocked(ssdUsed, selectedSsdGb) || isPlanBlocked(backupUsed, selectedBackupGb);
    const noChange = selectedSsdGb === ssdPlanGb && selectedBackupGb === backupPlanGb;

    if (blocked || noChange) return;

    setConfirmingPlan(true);
    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Phiên đăng nhập hết hạn.');

      const res = await fetch('/api/storage/upgrade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ssdGb: selectedSsdGb, backupGb: selectedBackupGb }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Cập nhật gói bộ nhớ thất bại.');
      }

      if (data.redirectUrl) {
        setShowUpgradeModal(false);
        router.push(data.redirectUrl);
        return;
      }

      setSsdPlanGb(data.ssdPlanGb as PlanGb);
      setBackupPlanGb(data.backupPlanGb as PlanGb);
      setShowUpgradeModal(false);
      setHasPendingUpgrade(false);
      setRejectedNote(null);
      setToastMessage('Đã cập nhật gói bộ nhớ!');
      loadStoragePlan();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Cập nhật gói bộ nhớ thất bại.');
    } finally {
      setConfirmingPlan(false);
    }
  };

  return (
    <div className="storage-panel">
      <div className="storage-page-header">
        <h2 className="storage-page-title">💾 Bộ nhớ</h2>
        {hasPendingUpgrade && (
          <span className="storage-status-badge pending">Đang chờ duyệt</span>
        )}
        {!hasPendingUpgrade && rejectedNote && (
          <span className="storage-status-badge rejected" title={rejectedNote}>
            Bị từ chối — {rejectedNote}
          </span>
        )}
      </div>

      <div className="storage-action-bar">
        <button
          type="button"
          className="btn storage-transfer-btn"
          onClick={handleOpenTransferModal}
          disabled={
            transferring ||
            !isMachineRunning ||
            (ssdFiles.length === 0 && backupFiles.length === 0)
          }
        >
          Chuyển dữ liệu SSD ⇄ Backup
        </button>
        {!isMobile && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={handleUploadBackup}>
            ⬆ Upload lên Backup
          </button>
        )}
        <button type="button" className="btn btn-sm btn-secondary" onClick={openUpgradeModal}>
          📈 Nâng cấp dung lượng
        </button>
      </div>

      {loading && (
        <div className="card">
          <p style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
            Đang tải dữ liệu bộ nhớ...
          </p>
        </div>
      )}

      {!loading && error && (
        <div className="card">
          <p style={{ padding: 24, color: '#f87171' }}>{error}</p>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            style={{ margin: '0 24px 24px' }}
            onClick={loadFiles}
          >
            Thử lại
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="storage-columns">
          <section
            ref={ssdSectionRef}
            className={`storage-card storage-card-ssd${!isMachineRunning ? ' storage-card-offline' : ''}${highlightSection === 'ssd' ? ' storage-section-highlight' : ''}`}
          >
            <div className="storage-card-header">
              <h3>⚡ SSD — Dùng ngay</h3>
              {machineState === 'running' && (
                <span className="storage-status online">Máy đang chạy</span>
              )}
              {machineState === 'syncing' && (
                <span className="storage-status syncing">Đang đồng bộ trạng thái</span>
              )}
              {machineState === 'offline' && (
                <span className="storage-status offline">Máy tắt</span>
              )}
            </div>

            {machineState === 'offline' && (
              <p className="storage-offline-notice">Máy đang tắt — không thể truy cập SSD</p>
            )}

            <div className={!isMachineRunning ? 'storage-card-body-dimmed' : undefined}>
              {isMachineRunning && runtimeDisk ? (
                <ProgressBar
                  used={runtimeDisk.used_gb * 1024 ** 3}
                  total={runtimeDisk.total_gb * 1024 ** 3}
                  variant="ssd"
                />
              ) : (
                <ProgressBar used={ssdUsed} total={ssdTotalBytes} variant="ssd" />
              )}

              <div className="storage-card-toolbar">
                <span className="storage-list-title">Thư mục</span>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={handleCleanTemp}
                  disabled={cleaning || !isMachineRunning}
                >
                  {cleaning ? 'Đang dọn...' : '🧹 Dọn dẹp'}
                </button>
              </div>

              <ul className="storage-folder-list">
                {ssdFolders.map((folder) => (
                  <li key={folder.category} className="storage-folder-item">
                    <span className="storage-folder-icon">{folder.icon}</span>
                    <div className="storage-folder-info">
                      <span className="storage-folder-name">{folder.label}</span>
                      <span className="storage-folder-meta">
                        {folder.count > 0 ? `${folder.count} mục · ` : 'Trống · '}
                        {formatBytes(folder.size)}
                        {folder.lastModified ? ` · Sửa ${formatDate(folder.lastModified)}` : ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section
            ref={backupSectionRef}
            className={`storage-card storage-card-backup${highlightSection === 'backup' ? ' storage-section-highlight' : ''}`}
          >
            <div className="storage-card-header">
              <h3>☁️ Backup</h3>
              <span className="storage-status backup">Luôn khả dụng</span>
            </div>

            <ProgressBar used={backupUsed} total={backupTotalBytes} variant="backup" />

            <span className="storage-list-title">File đã backup</span>

            {backupFiles.length === 0 ? (
              <p className="storage-empty">Chưa có file backup nào.</p>
            ) : (
              <ul className="storage-backup-list">
                {backupFiles.map((file) => (
                  <li key={file.id} className="storage-backup-item">
                    <div className="storage-backup-main">
                      <span className="storage-backup-name">{file.file_name}</span>
                      <span className="storage-backup-meta">
                        {formatBytes(Number(file.file_size_bytes))} · Backup {formatDateTime(file.created_at)}
                      </span>
                    </div>
                    <div className="storage-backup-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleBackupDownload(file)}
                      >
                        Tải xuống
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleBackupRestore(file)}
                      >
                        Khôi phục
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm storage-delete-btn"
                        onClick={() => handleBackupDelete(file)}
                        disabled={busyId === file.id}
                      >
                        {busyId === file.id ? '...' : 'Xóa'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <span className="storage-list-title" style={{ marginTop: 16 }}>
              Backup tự động (trước khi tắt máy)
            </span>

            {loadingAutoBackups ? (
              <p className="storage-empty">Đang tải backup logs...</p>
            ) : autoBackupLogs.length === 0 ? (
              <p className="storage-empty">Chưa có bản backup tự động nào.</p>
            ) : (
              <ul className="storage-backup-list">
                {autoBackupLogs.map((log) => (
                  <li key={log.id} className="storage-backup-item">
                    <div className="storage-backup-main">
                      <span className="storage-backup-name">{log.reasonLabel}</span>
                      <span className="storage-backup-meta">
                        {formatDateTime(log.createdAt)} · {formatBytes(log.sizeBytes)} ·{' '}
                        {autoBackupStatusLabel(log.status)}
                      </span>
                    </div>
                    <div className="storage-backup-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => void handleAutoBackupRestore(log)}
                        disabled={
                          restoringLogId === log.id ||
                          log.status === 'failed' ||
                          !isMachineRunning
                        }
                        title={
                          !isMachineRunning
                            ? 'Bật máy GPU để khôi phục'
                            : log.status === 'failed'
                              ? 'Backup thất bại'
                              : undefined
                        }
                      >
                        {restoringLogId === log.id ? 'Đang khôi phục...' : 'Khôi phục'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <StorageTransferModal
        open={showTransferModal}
        transferring={transferring}
        direction={transferDirection}
        ssdFiles={ssdFiles}
        backupFiles={backupFiles}
        ssdUsed={ssdUsed}
        backupUsed={backupUsed}
        ssdTotalBytes={ssdTotalBytes}
        backupTotalBytes={backupTotalBytes}
        onClose={() => !transferring && setShowTransferModal(false)}
        onDirectionChange={setTransferDirection}
        onConfirm={() => void handleConfirmTransfer()}
      />

      <StorageUpgradeModal
        open={showUpgradeModal}
        ssdPlanGb={ssdPlanGb}
        backupPlanGb={backupPlanGb}
        selectedSsdGb={selectedSsdGb}
        selectedBackupGb={selectedBackupGb}
        ssdUsed={ssdUsed}
        backupUsed={backupUsed}
        ssdPrices={ssdPrices}
        backupPrices={backupPrices}
        confirming={confirmingPlan}
        onClose={() => !confirmingPlan && setShowUpgradeModal(false)}
        onSelectSsd={setSelectedSsdGb}
        onSelectBackup={setSelectedBackupGb}
        onConfirm={handleConfirmPlanChange}
        onCleanUp={scrollToStorageSection}
      />

      {toastMessage && (
        <div className="storage-toast" role="status" aria-live="polite">
          ✓ {toastMessage}
        </div>
      )}
    </div>
  );
}
