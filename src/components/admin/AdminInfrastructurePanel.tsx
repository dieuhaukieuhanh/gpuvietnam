import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_INFRASTRUCTURE_FILTERS,
  INFRA_GPU_LINE_FILTERS,
  INFRA_PING_FILTERS,
  INFRA_PROVIDERS,
  INFRA_STATUS_FILTERS,
  INFRA_UPTIME_FILTERS,
  PING_BUCKET_LABELS,
  PING_THRESHOLD_MS,
  UPTIME_BUCKET_LABELS,
  UPTIME_THRESHOLD,
  type GpuStockStatus,
  type InfrastructureFilters,
  type InfrastructureGpuRow,
  filterInfrastructureRows,
  formatGpuLineLabel,
  formatPingMs,
} from '@/lib/infrastructure-shared';
import { formatVndPerHour } from '@/lib/currency';
import { adminFetch } from '@/lib/admin-session';

export type { GpuStockStatus, InfrastructureGpuRow };

/** Số phút giữa các lần tự cập nhật — lấy từ env, mặc định 15 phút. */
const REFRESH_MINUTES = Number(process.env.NEXT_PUBLIC_INFRA_REFRESH_MINUTES ?? 15);
const AUTO_REFRESH_MS = Number.isFinite(REFRESH_MINUTES) && REFRESH_MINUTES > 0
  ? REFRESH_MINUTES * 60 * 1000
  : 15 * 60 * 1000;

const STATUS_LABELS: Record<GpuStockStatus, string> = {
  stable: 'Ổn định',
  low: 'Ít hàng',
  scarce: 'Khan hiếm',
  unavailable: 'Không khả dụng',
};

const STATUS_BADGE: Record<GpuStockStatus, string> = {
  stable: 'infra-badge-stable',
  low: 'infra-badge-low',
  scarce: 'infra-badge-scarce',
  unavailable: 'infra-badge-unavailable',
};

function formatPriceUsd(price: number) {
  return `$${price.toFixed(2)}/h`;
}

/** HH:MM - DD/MM/YYYY */
function formatLastUpdated(date: Date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${h}:${m} - ${d}/${mo}/${y}`;
}

function StatusBadge({ status }: { status: GpuStockStatus }) {
  return (
    <span className={`badge infra-status-badge ${STATUS_BADGE[status]}`}>
      <span className="badge-dot" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

type InfrastructureTableRowProps = {
  row: InfrastructureGpuRow;
};

function InfrastructureTableRow({ row }: InfrastructureTableRowProps) {
  const unavailable = row.available <= 0 || row.status === 'unavailable';
  const gpuLabel = formatGpuLineLabel(row.gpu, row.vram);
  const uptimeLabel = UPTIME_BUCKET_LABELS[row.uptime_bucket] ?? row.uptime_bucket;
  const pingLabel = PING_BUCKET_LABELS[row.ping_bucket] ?? formatPingMs(row.ping_ms);

  return (
    <tr className={unavailable ? 'infra-row-unavailable' : ''}>
      <td>
        <span className="fw-600">{row.provider}</span>
      </td>
      <td className="mono fw-600">{gpuLabel}</td>
      <td>
        {unavailable ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="text-green">{uptimeLabel}</span>
        )}
      </td>
      <td>
        {unavailable ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="mono" title={formatPingMs(row.ping_ms)}>
            {pingLabel}
          </span>
        )}
      </td>
      <td>
        {unavailable ? (
          <span className="text-red">—</span>
        ) : (
          <>
            <span
              className={
                row.available >= 20
                  ? 'text-green'
                  : row.available >= 5
                    ? 'text-amber'
                    : 'text-red'
              }
            >
              {row.available}
            </span>
            <span className="text-muted" style={{ marginLeft: 4 }}>
              máy online
            </span>
          </>
        )}
      </td>
      <td className="mono">
        {unavailable || row.avg_price_10 <= 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="text-amber">{formatPriceUsd(row.avg_price_10)}</span>
        )}
      </td>
      <td className="mono">
        {unavailable || row.avg_price_10_vnd <= 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span>{formatVndPerHour(row.avg_price_10_vnd)}</span>
        )}
      </td>
      <td>
        <StatusBadge status={row.status} />
      </td>
    </tr>
  );
}

type LoadMode = 'initial' | 'manual' | 'auto';

type InfrastructureFilterBarProps = {
  filters: InfrastructureFilters;
  visibleCount: number;
  totalCount: number;
  onChange: (next: InfrastructureFilters) => void;
  onReset: () => void;
};

function InfrastructureFilterBar({
  filters,
  visibleCount,
  totalCount,
  onChange,
  onReset,
}: InfrastructureFilterBarProps) {
  return (
    <div className="card infra-filter-card">
      <div className="infra-filter-title">Bộ lọc</div>
      <div className="infra-filter-row">
        <select
          className="infra-filter-select"
          value={filters.provider}
          aria-label="Lọc nhà cung cấp"
          onChange={(e) => onChange({ ...filters, provider: e.target.value })}
        >
          <option value="all">Nhà cung cấp: Tất cả</option>
          {INFRA_PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>

        <select
          className="infra-filter-select"
          value={filters.gpuLine}
          aria-label="Lọc dòng GPU"
          onChange={(e) => onChange({ ...filters, gpuLine: e.target.value })}
        >
          {INFRA_GPU_LINE_FILTERS.map((line) => (
            <option key={line.value} value={line.value}>
              Dòng GPU: {line.label}
            </option>
          ))}
        </select>

        <select
          className="infra-filter-select"
          value={filters.uptime}
          aria-label="Lọc uptime"
          onChange={(e) => onChange({ ...filters, uptime: e.target.value })}
        >
          {INFRA_UPTIME_FILTERS.map((item) => (
            <option key={item.value} value={item.value}>
              Uptime: {item.label}
            </option>
          ))}
        </select>

        <select
          className="infra-filter-select"
          value={filters.ping}
          aria-label="Lọc ping"
          onChange={(e) => onChange({ ...filters, ping: e.target.value })}
        >
          {INFRA_PING_FILTERS.map((item) => (
            <option key={item.value} value={item.value}>
              Ping: {item.label}
            </option>
          ))}
        </select>

        <select
          className="infra-filter-select"
          value={filters.status}
          aria-label="Lọc trạng thái"
          onChange={(e) => onChange({ ...filters, status: e.target.value })}
        >
          {INFRA_STATUS_FILTERS.map((item) => (
            <option key={item.value} value={item.value}>
              Trạng thái: {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="infra-filter-footer">
        <button type="button" className="btn btn-sm" onClick={onReset}>
          🔄 Reset
        </button>
        <span className="infra-filter-count">
          Hiển thị: {visibleCount}/{totalCount} dòng
        </span>
      </div>
    </div>
  );
}

export default function AdminInfrastructurePanel() {
  const [items, setItems] = useState<InfrastructureGpuRow[]>([]);
  const [filters, setFilters] = useState<InfrastructureFilters>(DEFAULT_INFRASTRUCTURE_FILTERS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const initialLoadDone = useRef(false);

  const loadData = useCallback(async (mode: LoadMode = 'auto') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'manual') setRefreshing(true);
    if (mode !== 'auto') setError('');

    try {
      const res = await adminFetch('/api/admin/infrastructure');
      const data = await res.json();

      if (!res.ok) {
        const message = data.error ?? 'Không tải được dữ liệu hạ tầng.';
        if (mode === 'auto') return;
        setError(message);
        return;
      }

      const list = Array.isArray(data) ? data : (data.items ?? []);
      setItems(list);
      setLastUpdated(new Date());
      setError('');
    } catch {
      if (mode !== 'auto') {
        setError('Lỗi mạng khi tải dữ liệu hạ tầng.');
      }
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'manual') setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData('initial').then(() => {
      initialLoadDone.current = true;
    });

    const intervalId = window.setInterval(() => {
      if (initialLoadDone.current) {
        void loadData('auto');
      }
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [loadData]);

  const filteredItems = useMemo(
    () => filterInfrastructureRows(items, filters),
    [items, filters],
  );

  const warningCount = useMemo(
    () => items.filter((row) => row.status === 'scarce' || row.status === 'unavailable').length,
    [items],
  );

  const isUpdating = loading || refreshing;

  const handleResetFilters = () => {
    setFilters(DEFAULT_INFRASTRUCTURE_FILTERS);
  };

  return (
    <>
      <div className="infra-refresh-header">
        <div className="infra-refresh-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm infra-refresh-btn"
            disabled={isUpdating}
            onClick={() => loadData('manual')}
          >
            {refreshing ? (
              <>
                <span className="infra-spinner" aria-hidden />
                Đang cập nhật...
              </>
            ) : (
              <>🔄 Cập nhật ngay</>
            )}
          </button>
          {lastUpdated && (
            <span className="infra-last-updated">
              Cập nhật lần cuối: {formatLastUpdated(lastUpdated)}
            </span>
          )}
          <span className="infra-refresh-interval">
            Tự động cập nhật mỗi {REFRESH_MINUTES} phút
          </span>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="card">
          <p className="text-muted">Đang tải danh sách GPU sẵn sàng...</p>
        </div>
      ) : error && items.length === 0 ? (
        <div className="card">
          <p className="text-red">{error}</p>
          <button
            type="button"
            className="btn"
            style={{ marginTop: 12 }}
            onClick={() => loadData('initial')}
          >
            Thử lại
          </button>
        </div>
      ) : (
        <>
          {error && (
            <div className="card" style={{ marginBottom: 16 }}>
              <p className="text-red">{error}</p>
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <p className="stat-sub" style={{ lineHeight: 1.6, marginTop: 0 }}>
              Mỗi dòng = 1 nhà cung cấp + 1 dòng GPU + 1 mức Uptime + 1 mức Ping — giá TB tính
              riêng trong nhóm đó · Cùng bộ lọc provision (disk/RAM/CUDA/VRAM theo gói · ping ≤{' '}
              {PING_THRESHOLD_MS}ms · uptime ≥ {UPTIME_THRESHOLD}% · currency Clore) · Tự động cập
              nhật mỗi {REFRESH_MINUTES} phút
            </p>
          </div>

          <InfrastructureFilterBar
            filters={filters}
            visibleCount={filteredItems.length}
            totalCount={items.length}
            onChange={setFilters}
            onReset={handleResetFilters}
          />

          {warningCount > 0 && (
            <div className="infra-alert-banner">
              <span aria-hidden>⚠</span>
              <div>
                <div className="fw-600">
                  Có {warningCount} dòng GPU đang khan hiếm hoặc không khả dụng
                </div>
                <div className="stat-sub" style={{ marginTop: 4 }}>
                  Kiểm tra ngay để tránh ảnh hưởng provisioning khách hàng.
                </div>
              </div>
            </div>
          )}

          <div className="card-no-pad infra-provider-section">
            <div className="card-header-row">
              <span className="stat-label" style={{ marginBottom: 0 }}>
                GPU sẵn sàng (toàn cầu) — Uptime ≥ {UPTIME_THRESHOLD}% · Ping ≤ {PING_THRESHOLD_MS}ms
              </span>
            </div>
            <div className="table-wrap">
              <table className="infra-table">
                <thead>
                  <tr>
                    <th>Nhà cung cấp</th>
                    <th>Dòng GPU</th>
                    <th>Uptime</th>
                    <th>Ping</th>
                    <th>Số lượng</th>
                    <th>Giá TB 10 rẻ nhất</th>
                    <th>Giá VNĐ</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr className="infra-table-empty">
                      <td colSpan={8}>Không có dòng nào khớp bộ lọc hiện tại.</td>
                    </tr>
                  ) : (
                    filteredItems.map((row) => (
                      <InfrastructureTableRow
                        key={`${row.provider}-${row.gpu}-${row.vram}-${row.uptime_bucket}-${row.ping_bucket}`}
                        row={row}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="stat-label">Quy tắc tính giá & trạng thái</div>
            <ul className="infra-rules-list">
              <li>
                Mỗi dòng duy nhất theo Provider + GPU + Uptime + Ping — giá TB 10 rẻ nhất tính trong
                nhóm đó.
              </li>
              <li>
                3 dòng GPU: RTX 3090 (Starter) / RTX 4090 1x (Pro) / RTX 5090 (Studio) — cùng hard
                filters với provision (disk tối thiểu theo gói, VRAM/CUDA theo gói, RAM ≥ 16GB khi
                có báo cáo) · Uptime ≥ {UPTIME_THRESHOLD}% · Ping ≤ {PING_THRESHOLD_MS}ms.
              </li>
              <li>
                Uptime: &gt;99% · 98.5%–99% · 98%–98.5% · Ping: &lt;50 · 50–100 · 100–200 · 200–250
                ms.
              </li>
              <li>
                <span className="badge badge-green">Ổn định</span> ≥ 20 máy ·{' '}
                <span className="badge badge-amber">Ít hàng</span> 5–19 ·{' '}
                <span className="badge badge-red">Khan hiếm</span> &lt;5 ·{' '}
                <span className="badge badge-red">Không khả dụng</span> 0 máy
              </li>
            </ul>
          </div>

          <div className="infra-footer">
            <span>GPU Vietnam Admin · Hạ tầng</span>
            {lastUpdated && (
              <span className="infra-last-updated">
                Cập nhật lần cuối: {formatLastUpdated(lastUpdated)}
              </span>
            )}
          </div>
        </>
      )}
    </>
  );
}
