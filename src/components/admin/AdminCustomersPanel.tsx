import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_CUSTOMER_FILTERS,
  formatSessionDurationShort,
  type AdminCustomerRow,
  type CustomerAnomalySummary,
  type CustomerFilters,
  type CustomerSortField,
  type CustomerStats,
} from '@/lib/admin-customers-shared';
import type { CustomerAnomaly, CustomerAnomalySummaryItem } from '@/lib/customer-anomalies';
import { adminFetch } from '@/lib/admin-session';
import { exportCustomersToExcel } from '@/lib/export-customers-excel';
import AdminRemoteSupportModal from '@/components/admin/AdminRemoteSupportModal';
import AdminMachineToggleModal, {
  AdminMachineManagementSection,
  MachineToggleButton,
  type MachineToggleAction,
} from '@/components/admin/AdminMachineToggleModal';

function formatVnd(amount: number) {
  return `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;
}

function formatVndShort(amount: number) {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1).replace('.0', '')}tr`;
  return new Intl.NumberFormat('vi-VN').format(amount);
}

function formatLastAccess(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncateText(text: string, max = 22) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function avatarLetter(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1]?.charAt(0) ?? name.charAt(0) ?? '?').toUpperCase();
}

function planBadgeClass(plan: string) {
  if (plan === 'Starter') return 'badge-blue';
  if (plan === 'Pro') return 'badge-purple';
  if (plan === 'Studio') return 'badge-green';
  return 'badge-gray';
}

function progressColor(hoursLeft: number, totalHours: number) {
  const pct = totalHours > 0 ? (hoursLeft / totalHours) * 100 : 0;
  if (pct > 30) return '';
  if (pct > 10) return 'amber';
  return 'red';
}

const ANOMALY_BADGE_CLASS: Record<CustomerAnomaly['severity'], string> = {
  high: 'anomaly-badge-high',
  medium: 'anomaly-badge-medium',
  low: 'anomaly-badge-low',
};

function liveDurationSeconds(row: AdminCustomerRow, now: number) {
  if (!row.isOnline) return row.currentSessionDuration;
  if (row.sessionStartedAt) {
    const started = new Date(row.sessionStartedAt).getTime();
    if (!Number.isNaN(started)) {
      return Math.max(0, Math.floor((now - started) / 1000));
    }
  }
  return row.currentSessionDuration;
}

function OnlineCompactCell({ row, now }: { row: AdminCustomerRow; now: number }) {
  if (row.isOnline) {
    const duration = formatSessionDurationShort(liveDurationSeconds(row, now));
    return (
      <span className="online-compact online-compact-yes">
        🟢 Online · {duration}
      </span>
    );
  }
  return <span className="online-compact online-compact-no">⚫ Offline</span>;
}

function AnomalyCompactCell({ row }: { row: AdminCustomerRow }) {
  if (!row.anomalies.length) {
    return <span className="text-muted">—</span>;
  }
  const icon =
    row.anomalyLevel === 'high' ? '🔴' : row.anomalyLevel === 'medium' ? '🟡' : '⚪';
  return (
    <span className="anomaly-compact" title={row.anomalies.map((a) => a.label).join(', ')}>
      {icon} {row.anomalies.length}
    </span>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="customer-detail-field">
      <span className="customer-detail-label">{label}</span>
      <span className="customer-detail-value">{value}</span>
    </div>
  );
}

function CustomerExpandPanel({
  row,
  now,
  toggleBusy,
  onRemoteSupport,
  onMachineToggle,
}: {
  row: AdminCustomerRow;
  now: number;
  toggleBusy: boolean;
  onRemoteSupport: (row: AdminCustomerRow) => void;
  onMachineToggle: (row: AdminCustomerRow, action: MachineToggleAction) => void;
}) {
  const hasRenewed = row.history.length > 1;

  return (
    <div className="customer-expand-inner">
      <div className="customer-expand-grid">
        <div className="customer-expand-col">
          <DetailField label="Email" value={row.email} />
          <DetailField label="SĐT" value={row.phone ?? '—'} />
          <DetailField label="Region" value={row.region} />
          <DetailField label="Workflow" value={row.workflow} />
          <DetailField label="Model" value={row.model} />
          <DetailField label="Lần cuối" value={formatLastAccess(row.lastAccess)} />
        </div>
        <div className="customer-expand-col">
          <DetailField label="Hành trình" value={row.journey} />
          <DetailField label="Doanh thu" value={<span className="text-green">{formatVnd(row.revenue)}</span>} />
          <DetailField label="TB giờ/ngày" value={`${row.avgDaily.toFixed(1)}h`} />
          <DetailField label="Phiên/tuần" value={row.sessionsPerWeek} />
          <DetailField label="Tỷ lệ tái tục" value={hasRenewed ? 'Có tái tục' : 'Chưa tái tục'} />
          <DetailField label="Lịch sử gói" value={row.history.join(' → ') || '—'} />
        </div>
      </div>

      {row.anomalies.length > 0 && (
        <div className="customer-expand-alerts">
          <div className="customer-detail-label" style={{ marginBottom: 8 }}>
            Chi tiết cảnh báo
          </div>
          <div className="customer-expand-alert-list">
            {row.anomalies.map((a) => (
              <div key={a.code} className={`customer-expand-alert-item anomaly-badge ${ANOMALY_BADGE_CLASS[a.severity]}`}>
                <span>
                  {a.severity === 'high' ? '🔴' : a.severity === 'medium' ? '🟡' : '⚪'} {a.label}
                </span>
                <span className="customer-expand-alert-detail">{a.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <AdminMachineManagementSection
        row={row}
        now={now}
        toggleBusy={toggleBusy}
        onToggle={onMachineToggle}
      />

      <div className="customer-expand-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => onRemoteSupport(row)}>
          👁 Hỗ trợ từ xa
        </button>
        <button type="button" className="btn btn-sm" onClick={() => alert(`Khóa TK: ${row.name} (demo)`)}>
          🔒 Khóa TK
        </button>
        <button type="button" className="btn btn-sm" onClick={() => alert(`Gửi email tới ${row.email} (demo)`)}>
          ✉ Gửi email
        </button>
        <button type="button" className="btn btn-sm" onClick={() => alert(`Xem phiên GPU: ${row.name} (demo)`)}>
          👁 Xem phiên
        </button>
      </div>
    </div>
  );
}

type CustomerRowGroupProps = {
  row: AdminCustomerRow;
  now: number;
  isExpanded: boolean;
  toggleBusy: boolean;
  onToggle: () => void;
  onRemoteSupport: (row: AdminCustomerRow) => void;
  onMachineToggle: (row: AdminCustomerRow, action: MachineToggleAction) => void;
};

function CustomerRowGroup({
  row,
  now,
  isExpanded,
  toggleBusy,
  onToggle,
  onRemoteSupport,
  onMachineToggle,
}: CustomerRowGroupProps) {
  const pct = row.totalHours > 0 ? Math.min(100, Math.round((row.hoursLeft / row.totalHours) * 100)) : 0;
  const barColor = progressColor(row.hoursLeft, row.totalHours);

  return (
    <>
      <tr
        className={`customer-row-main${isExpanded ? ' is-expanded' : ''}`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <td className="cell-customer">
          <div className="customer-row">
            <div className="customer-avatar">{avatarLetter(row.name)}</div>
            <div className="customer-meta">
              <div className="customer-name" title={row.name}>
                {truncateText(row.name)}
              </div>
              <div className="customer-email" title={row.email}>
                {row.email}
              </div>
            </div>
          </div>
        </td>
        <td className="cell-compact">
          <span className={`badge ${planBadgeClass(row.plan)}`}>{row.plan}</span>
        </td>
        <td className="cell-hours col-hide-mobile">
          <div className="hours-row">
            <div className="progress progress-sm">
              <div className={`progress-bar ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="mono hours-value">{row.hoursLeft}h</span>
          </div>
        </td>
        <td className="cell-compact">
          <OnlineCompactCell row={row} now={now} />
        </td>
        <td className="col-hide-mobile">
          <AnomalyCompactCell row={row} />
        </td>
        <td className="cell-compact">
          <MachineToggleButton
            row={row}
            now={now}
            busy={toggleBusy}
            compact
            onToggle={onMachineToggle}
          />
        </td>
        <td className="cell-expand">
          <div className="customer-row-actions">
            <button
              type="button"
              className="btn btn-sm customer-remote-support-btn"
              title="Hỗ trợ từ xa"
              onClick={(e) => {
                e.stopPropagation();
                onRemoteSupport(row);
              }}
            >
              👁
            </button>
            <button
              type="button"
              className={`expand-toggle${isExpanded ? ' is-open' : ''}`}
              aria-label={isExpanded ? 'Thu gọn' : 'Mở rộng'}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              ›
            </button>
          </div>
        </td>
      </tr>
      <tr className={`customer-row-expand${isExpanded ? ' is-open' : ''}`}>
        <td colSpan={7}>
          <div className={`customer-expand-panel${isExpanded ? ' open' : ''}`}>
            {isExpanded && (
              <CustomerExpandPanel
                row={row}
                now={now}
                toggleBusy={toggleBusy}
                onRemoteSupport={onRemoteSupport}
                onMachineToggle={onMachineToggle}
              />
            )}
          </div>
        </td>
      </tr>
    </>
  );
}

type AnomalyBannerProps = {
  summary: CustomerAnomalySummary | null;
  onFilterAlert: (value: string) => void;
};

function AnomalyChipWithTooltip({
  item,
  onFilterAlert,
}: {
  item: CustomerAnomalySummaryItem;
  onFilterAlert: (value: string) => void;
}) {
  return (
    <span className="anomaly-chip-wrap">
      <button
        type="button"
        className={`anomaly-chip ${ANOMALY_BADGE_CLASS[item.severity]}`}
        onClick={() => onFilterAlert(item.severity === 'high' ? 'critical' : 'hasAlert')}
        aria-describedby={`anomaly-tip-${item.code}`}
      >
        {item.label} ({item.count})
      </button>
      <span id={`anomaly-tip-${item.code}`} className="anomaly-chip-tooltip" role="tooltip">
        <span className="anomaly-chip-tooltip-title">{item.label}</span>
        {item.customers.map((name) => (
          <span key={name} className="anomaly-chip-tooltip-row">
            · {name}
          </span>
        ))}
      </span>
    </span>
  );
}

function CustomerAnomaliesBanner({ summary, onFilterAlert }: AnomalyBannerProps) {
  if (!summary || summary.flaggedCount === 0) return null;

  return (
    <div className="customers-anomaly-banner">
      <div className="customers-anomaly-banner-icon" aria-hidden>
        ⚠
      </div>
      <div className="customers-anomaly-banner-body">
        <div className="customers-anomaly-banner-title">
          {summary.flaggedCount} khách hàng có hành vi bất thường
          {summary.criticalCount > 0 && (
            <span className="text-red"> · {summary.criticalCount} nghiêm trọng</span>
          )}
        </div>
        <div className="customers-anomaly-banner-list">
          {summary.items.slice(0, 4).map((item) => (
            <AnomalyChipWithTooltip
              key={item.code}
              item={item}
              onFilterAlert={onFilterAlert}
            />
          ))}
        </div>
        <div className="stat-sub" style={{ marginTop: 6 }}>
          Nhiều máy cùng lúc, không có output, phiên quá dài… — hover chip để xem KH, bấm để lọc.
        </div>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => onFilterAlert('hasAlert')}>
        Xem tất cả
      </button>
    </div>
  );
}

const CUSTOMERS_POLL_MS = 30_000;

function buildCustomersQuery(
  filters: CustomerFilters,
  sortField: CustomerSortField,
  sortOrder: 'asc' | 'desc',
) {
  const params = new URLSearchParams();
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.plan !== 'all') params.set('plan', filters.plan);
  if (filters.template !== 'all') params.set('template', filters.template);
  if (filters.region !== 'all') params.set('region', filters.region);
  if (filters.alert !== 'all') params.set('alert', filters.alert);
  if (filters.search.trim()) params.set('search', filters.search.trim());
  params.set('sort', sortField);
  params.set('order', sortOrder);
  const qs = params.toString();
  return qs ? `/api/admin/customers?${qs}` : '/api/admin/customers';
}

export default function AdminCustomersPanel() {
  const [stats, setStats] = useState<CustomerStats | null>(null);
  const [items, setItems] = useState<AdminCustomerRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFilters] = useState<CustomerFilters>(DEFAULT_CUSTOMER_FILTERS);
  const [sortField, setSortField] = useState<CustomerSortField>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [onlineCount, setOnlineCount] = useState(0);
  const [anomalySummary, setAnomalySummary] = useState<CustomerAnomalySummary | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [supportCustomer, setSupportCustomer] = useState<AdminCustomerRow | null>(null);
  const [machineToggleCustomer, setMachineToggleCustomer] = useState<AdminCustomerRow | null>(null);
  const [machineToggleAction, setMachineToggleAction] = useState<MachineToggleAction | null>(null);
  const [machineToggleBusyUserId, setMachineToggleBusyUserId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const toggleExpandedRow = useCallback((rowId: string) => {
    setExpandedRowId((prev) => (prev === rowId ? null : rowId));
  }, []);

  const openMachineToggle = useCallback((row: AdminCustomerRow, action: MachineToggleAction) => {
    setMachineToggleCustomer(row);
    setMachineToggleAction(action);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const loadCustomers = useCallback(
    async (silent = false) => {
      if (!silent) {
        setRefreshing(true);
        setError('');
      }

      try {
        const customersRes = await adminFetch(buildCustomersQuery(filters, sortField, sortOrder));
        const customersData = await customersRes.json();

        if (!customersRes.ok) {
          if (!silent) setError(customersData.error ?? 'Không tải được danh sách khách hàng.');
          return;
        }

        setItems(customersData.items ?? []);
        setTotalCount(customersData.total ?? customersData.items?.length ?? 0);
        setOnlineCount(customersData.onlineCount ?? 0);
        setAnomalySummary(customersData.anomalySummary ?? null);
        setUpdatedAt(new Date());
      } catch {
        if (!silent) setError('Lỗi mạng khi tải dữ liệu khách hàng.');
      } finally {
        if (!silent) setRefreshing(false);
      }
    },
    [filters, sortField, sortOrder],
  );

  const handleMachineToggleSuccess = useCallback(
    (message: string) => {
      setToast(message);
      setMachineToggleBusyUserId(null);
      void loadCustomers(true);
    },
    [loadCustomers],
  );

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const [statsRes, customersRes] = await Promise.all([
        adminFetch('/api/admin/customer-stats'),
        adminFetch(buildCustomersQuery(filters, sortField, sortOrder)),
      ]);

      const statsData = await statsRes.json();
      const customersData = await customersRes.json();

      if (!statsRes.ok) {
        setError(statsData.error ?? 'Không tải được thống kê.');
        return;
      }
      if (!customersRes.ok) {
        setError(customersData.error ?? 'Không tải được danh sách khách hàng.');
        return;
      }

      setStats(statsData);
      setItems(customersData.items ?? []);
      setTotalCount(customersData.total ?? customersData.items?.length ?? 0);
      setOnlineCount(customersData.onlineCount ?? 0);
      setAnomalySummary(customersData.anomalySummary ?? null);
      setUpdatedAt(new Date());
    } catch {
      setError('Lỗi mạng khi tải dữ liệu khách hàng.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters, sortField, sortOrder]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const pollId = window.setInterval(() => {
      void loadCustomers(true);
    }, CUSTOMERS_POLL_MS);
    return () => window.clearInterval(pollId);
  }, [loadCustomers]);

  useEffect(() => {
    const hasOnline = items.some((row) => row.isOnline);
    if (!hasOnline) return undefined;
    const tickId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tickId);
  }, [items]);

  const handleSort = (field: CustomerSortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_CUSTOMER_FILTERS);
  };

  const handleExportExcel = async () => {
    if (items.length === 0) {
      alert('Không có dữ liệu để xuất. Hãy điều chỉnh bộ lọc hoặc làm mới danh sách.');
      return;
    }

    setExporting(true);
    try {
      await exportCustomersToExcel(items, stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không thể xuất file Excel.';
      alert(message);
    } finally {
      setExporting(false);
    }
  };

  const formattedAvgRevenue = useMemo(() => {
    if (!stats) return '—';
    return formatVndShort(stats.avgRevenuePerCustomer);
  }, [stats]);

  if (loading && !stats) {
    return (
      <div className="admin-customers-panel">
        <div className="card">
          <p className="text-muted">Đang tải phân tích khách hàng...</p>
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="admin-customers-panel">
        <div className="card">
          <p className="text-red">{error}</p>
          <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => loadData()}>
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-customers-panel">
      <div className="customers-toolbar">
        <span className="live-sync-note">
          {onlineCount > 0 ? (
            <>
              <span className="live-dot">●</span> {onlineCount} KH online · cập nhật mỗi 30s
            </>
          ) : (
            <>Cập nhật trạng thái mỗi 30s</>
          )}
        </span>
        <button
          type="button"
          className="btn btn-success btn-sm"
          disabled={exporting || loading}
          onClick={() => void handleExportExcel()}
        >
          {exporting ? 'Đang xuất...' : '📥 Xuất Excel'}
        </button>
        <button type="button" className="btn btn-sm" disabled={refreshing} onClick={() => loadData(true)}>
          {refreshing ? 'Đang làm mới...' : '⟳ Làm mới'}
        </button>
      </div>

      {stats && (
        <>
          <div className="grid-4">
            <div className="card">
              <div className="stat-label">Tổng khách hàng</div>
              <div className="stat-value text-blue">{stats.totalCustomers}</div>
              <div className="stat-sub">+{stats.newThisMonth} trong tháng này</div>
            </div>
            <div className="card">
              <div className="stat-label">Đang sử dụng</div>
              <div className="stat-value text-green">{stats.activeUsing}</div>
              <div className="stat-sub">có GPU đang chạy</div>
            </div>
            <div className="card">
              <div className="stat-label">Còn giờ</div>
              <div className="stat-value text-amber">{stats.withHours}</div>
              <div className="stat-sub">chưa hết hạn</div>
            </div>
            <div className="card">
              <div className="stat-label">Doanh thu bình quân/KH</div>
              <div className="stat-value text-purple">{formattedAvgRevenue}</div>
              <div className="stat-sub">tổng {formatVndShort(stats.totalRevenue)}</div>
            </div>
          </div>

          <div className="grid-3">
            <div className="card">
              <div className="stat-label">Tỷ lệ tái gia hạn (Retention)</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                <span className="stat-value text-green">{stats.retentionRate}%</span>
                <span className="text-dim" style={{ fontSize: 13 }}>
                  (+{stats.retentionDelta}% so với tháng trước)
                </span>
              </div>
              <div className="stat-sub">KH quay lại sau khi hết gói</div>
            </div>
            <div className="card">
              <div className="stat-label">Giờ cao điểm (Peak hour)</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                <span>
                  <span className="badge badge-amber">🌅 Sáng</span> {stats.peakHours.morning}%
                </span>
                <span>
                  <span className="badge badge-blue">☀️ Chiều</span> {stats.peakHours.afternoon}%
                </span>
                <span>
                  <span className="badge badge-purple">🌙 Tối</span> {stats.peakHours.evening}%
                </span>
              </div>
              <div className="stat-sub">{stats.peakHourNote}</div>
            </div>
            <div className="card">
              <div className="stat-label">GPU ưa chuộng</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                {stats.gpuRegions.map((region) => (
                  <span key={region.label}>
                    <span className={`badge ${region.badge}`}>{region.label}</span> {region.percent}%
                  </span>
                ))}
              </div>
              <div className="stat-sub">{stats.templateNote}</div>
            </div>
          </div>

          <CustomerAnomaliesBanner
            summary={anomalySummary}
            onFilterAlert={(alert) => setFilters((f) => ({ ...f, alert }))}
          />
        </>
      )}

      <div className="card" style={{ padding: '12px 20px' }}>
        <div className="stat-label" style={{ marginBottom: 8 }}>
          Bộ lọc
        </div>
        <div className="filter-bar">
          <div className="filter-group">
            <label htmlFor="filter-status">Trạng thái</label>
            <select
              id="filter-status"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="all">Tất cả</option>
              <option value="online">Đang online</option>
              <option value="active">Đang sử dụng</option>
              <option value="hasHours">Còn giờ</option>
              <option value="expired">Hết giờ</option>
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="filter-plan">Gói</label>
            <select
              id="filter-plan"
              value={filters.plan}
              onChange={(e) => setFilters((f) => ({ ...f, plan: e.target.value }))}
            >
              <option value="all">Tất cả</option>
              <option value="Starter">Starter</option>
              <option value="Pro">Pro</option>
              <option value="Studio">Studio</option>
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="filter-template">Template</label>
            <select
              id="filter-template"
              value={filters.template}
              onChange={(e) => setFilters((f) => ({ ...f, template: e.target.value }))}
            >
              <option value="all">Tất cả</option>
              <option value="ComfyUI">ComfyUI</option>
              <option value="A1111">A1111</option>
              <option value="Video AI">Video AI</option>
              <option value="Blender">Blender</option>
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="filter-region">Region</label>
            <select
              id="filter-region"
              value={filters.region}
              onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))}
            >
              <option value="all">Tất cả</option>
              <option value="Singapore">Singapore</option>
              <option value="Japan">Japan</option>
              <option value="US">US</option>
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="filter-alert">Cảnh báo</label>
            <select
              id="filter-alert"
              value={filters.alert}
              onChange={(e) => setFilters((f) => ({ ...f, alert: e.target.value }))}
            >
              <option value="all">Tất cả</option>
              <option value="hasAlert">Có cảnh báo</option>
              <option value="critical">Nghiêm trọng</option>
              <option value="warning">Cần theo dõi</option>
            </select>
          </div>
          <div className="filter-group filter-search">
            <input
              type="text"
              placeholder="🔍 Tìm tên, email..."
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </div>
        </div>
        <div className="filter-footer">
          <button type="button" className="btn btn-sm" onClick={handleResetFilters}>
            🔄 Reset
          </button>
          <span className="text-muted" style={{ fontSize: 12 }}>
            Hiển thị {items.length}/{totalCount} dòng
          </span>
        </div>
      </div>

      {toast && (
        <div className="card" style={{ marginBottom: 16, padding: '10px 16px' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--accent-green)' }}>{toast}</p>
        </div>
      )}

      {error && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="text-red">{error}</p>
        </div>
      )}

      <div className="card-no-pad">
        <div className="card-header-row">
          <span className="stat-label" style={{ marginBottom: 0 }}>
            Danh sách khách hàng
          </span>
        </div>
        <div className="table-wrap customers-compact-table">
          <table className="customers-main-table">
            <colgroup>
              <col className="col-main-customer" />
              <col className="col-main-plan" />
              <col className="col-main-hours col-hide-mobile" />
              <col className="col-main-online" />
              <col className="col-main-anomaly col-hide-mobile" />
              <col className="col-main-actions" />
              <col className="col-main-expand" />
            </colgroup>
            <thead>
              <tr>
                <th
                  className={`sortable${sortField === 'name' ? ` sorted-${sortOrder}` : ''}`}
                  onClick={() => handleSort('name')}
                >
                  KH
                </th>
                <th
                  className={`sortable${sortField === 'plan' ? ` sorted-${sortOrder}` : ''}`}
                  onClick={() => handleSort('plan')}
                >
                  Gói
                </th>
                <th
                  className={`sortable col-hide-mobile${sortField === 'hoursLeft' ? ` sorted-${sortOrder}` : ''}`}
                  onClick={() => handleSort('hoursLeft')}
                >
                  Giờ còn
                </th>
                <th>Online</th>
                <th
                  className={`sortable col-hide-mobile${sortField === 'anomalyLevel' ? ` sorted-${sortOrder}` : ''}`}
                  onClick={() => handleSort('anomalyLevel')}
                >
                  Cảnh báo
                </th>
                <th>Hành động</th>
                <th className="cell-expand-header" aria-label="Mở rộng">
                  👁
                </th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr className="customers-table-empty">
                  <td colSpan={7}>Không tìm thấy khách hàng phù hợp</td>
                </tr>
              ) : (
                items.map((row) => (
                  <CustomerRowGroup
                    key={row.id}
                    row={row}
                    now={now}
                    isExpanded={expandedRowId === row.id}
                    toggleBusy={machineToggleBusyUserId === row.userId}
                    onToggle={() => toggleExpandedRow(row.id)}
                    onRemoteSupport={setSupportCustomer}
                    onMachineToggle={openMachineToggle}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="customers-footer">
        <span>GPU Vietnam Admin · Phân tích khách hàng</span>
        {updatedAt && (
          <span>
            Cập nhật:{' '}
            {updatedAt.toLocaleString('vi-VN', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        )}
      </div>

      <AdminRemoteSupportModal
        open={Boolean(supportCustomer)}
        customer={supportCustomer}
        onClose={() => setSupportCustomer(null)}
      />

      <AdminMachineToggleModal
        open={Boolean(machineToggleCustomer && machineToggleAction)}
        customer={machineToggleCustomer}
        action={machineToggleAction}
        now={now}
        onClose={() => {
          setMachineToggleCustomer(null);
          setMachineToggleAction(null);
          setMachineToggleBusyUserId(null);
        }}
        onSuccess={handleMachineToggleSuccess}
        onBusyChange={setMachineToggleBusyUserId}
      />
    </div>
  );
}
