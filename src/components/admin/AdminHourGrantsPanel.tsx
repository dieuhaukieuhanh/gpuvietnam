import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminCustomerRow } from '@/lib/admin-customers-shared';
import {
  formatCurrency,
  getPlanConfig,
  getPlanKeyFromName,
  getPlanPrice,
  PLAN_ORDER,
} from '@/lib/gpu-pricing';
import { adminFetch } from '@/lib/admin-session';

type SubTab = 'grant' | 'adjust' | 'history';
type GpuPlanKey = (typeof PLAN_ORDER)[number];
type AdjustAction = 'add' | 'reduce' | 'revoke' | 'extend';
type HistoryFilter = 'all' | 'grant' | 'add' | 'reduce' | 'revoke' | 'extend';

type HourGrant = {
  id: number;
  hours_granted: number;
  hours_used: number;
  hours_remaining: number;
  expires_at: string | null;
  internal_note: string | null;
  customer_note: string | null;
  gpu_plan: string;
  status: string;
  created_at: string;
};

type HistoryItem = {
  id: number;
  grantId: number;
  actionType: string;
  amount: number | null;
  reason: string | null;
  createdAt: string;
  gpuPlan: string;
  customer: { id: string; name: string; email: string } | null;
  admin: { id: string; name: string; email: string } | null;
};

const GPU_PLAN_OPTIONS = PLAN_ORDER.map((key) => {
  const config = getPlanConfig(key);
  return {
    key,
    label: `${config?.name ?? key} (${config?.gpu ?? 'GPU'} · ${config?.vram ?? '—'} · ${formatCurrency(getPlanPrice(key, 'hourly'))}/h)`,
  };
});

function defaultGpuPlanFromCustomer(customer: AdminCustomerRow | null): GpuPlanKey {
  if (!customer || customer.plan === '—') return 'starter';
  return getPlanKeyFromName(customer.plan) ?? 'starter';
}

function normalizeGpuPlan(value: string | null | undefined): GpuPlanKey {
  if (value === 'starter' || value === 'pro' || value === 'studio') return value;
  return 'pro';
}

function gpuPlanShortLabel(planKey: string): string {
  const config = getPlanConfig(normalizeGpuPlan(planKey));
  if (!config) return planKey;
  return `${config.name} (${config.gpu})`;
}

function gpuPlanDisplayName(planKey: string): string {
  return getPlanConfig(normalizeGpuPlan(planKey))?.name ?? planKey;
}

const HISTORY_FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'grant', label: 'Tặng' },
  { value: 'add', label: 'Thêm' },
  { value: 'reduce', label: 'Giảm' },
  { value: 'revoke', label: 'Thu hồi' },
  { value: 'extend', label: 'Gia hạn' },
];

function formatDate(iso: string | null): string {
  if (!iso) return 'Không giới hạn';
  return new Date(iso).toLocaleDateString('vi-VN');
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function actionMeta(type: string) {
  switch (type) {
    case 'grant':
      return { icon: '🎁', label: 'Tặng', className: 'hg-action-grant' };
    case 'add':
      return { icon: '🔺', label: 'Thêm', className: 'hg-action-add' };
    case 'reduce':
      return { icon: '🔻', label: 'Giảm', className: 'hg-action-reduce' };
    case 'revoke':
      return { icon: '❌', label: 'Thu hồi', className: 'hg-action-revoke' };
    case 'extend':
      return { icon: '📅', label: 'Gia hạn', className: 'hg-action-extend' };
    default:
      return { icon: '•', label: type, className: 'hg-action-grant' };
  }
}

function CustomerSearch({
  label,
  selected,
  onSelect,
  onClear,
}: {
  label: string;
  selected: AdminCustomerRow | null;
  onSelect: (customer: AdminCustomerRow) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminCustomerRow[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  const searchCustomers = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      const res = await adminFetch(`/api/admin/customers?search=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (!res.ok) {
        setResults([]);
        return;
      }
      const items = (data.items ?? []) as AdminCustomerRow[];
      const lower = trimmed.toLowerCase();
      const filtered = items.filter((row) => {
        const hay = `${row.name} ${row.email} ${row.phone ?? ''}`.toLowerCase();
        return hay.includes(lower);
      });
      setResults(filtered.slice(0, 8));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void searchCustomers(query);
    }, 300);
    return () => window.clearTimeout(id);
  }, [query, searchCustomers]);

  if (selected) {
    return (
      <div className="hg-field">
        <label>{label}</label>
        <div className="hg-selected-customer">
          <strong>{selected.name}</strong>
          <span>{selected.email}</span>
          {selected.phone && <span>SĐT: {selected.phone}</span>}
          <span>
            Gói hiện tại: <strong>{selected.plan}</strong> · Giờ còn:{' '}
            <strong>{selected.hoursLeft}</strong>
          </span>
          <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={onClear}>
            Đổi khách hàng
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hg-field">
      <label>{label}</label>
      <div className="hg-search-wrap">
        <input
          type="text"
          className="hg-input"
          placeholder="Tìm theo tên, email, SĐT..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {open && query.trim().length >= 2 && (
          <div className="hg-search-results">
            {searching && <div className="hg-empty">Đang tìm...</div>}
            {!searching && results.length === 0 && (
              <div className="hg-empty">Không tìm thấy khách hàng</div>
            )}
            {!searching &&
              results.map((row) => (
                <button
                  key={row.userId ?? row.id}
                  type="button"
                  className="hg-search-item"
                  onClick={() => {
                    onSelect(row);
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  {row.name}
                  <small>
                    {row.email}
                    {row.phone ? ` · ${row.phone}` : ''} · {row.plan}
                  </small>
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GrantNewTab({ onSuccess }: { onSuccess: (msg: string) => void }) {
  const [customer, setCustomer] = useState<AdminCustomerRow | null>(null);
  const [hours, setHours] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [noExpiry, setNoExpiry] = useState(false);
  const [internalNote, setInternalNote] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [gpuPlan, setGpuPlan] = useState<GpuPlanKey>('starter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setGpuPlan(defaultGpuPlanFromCustomer(customer));
  }, [customer]);

  const hoursNum = Number.parseInt(hours, 10);
  const previewValid = customer && Number.isFinite(hoursNum) && hoursNum > 0;
  const equivalentValue = previewValid ? hoursNum * getPlanPrice(gpuPlan, 'hourly') : 0;

  const handleCustomerSelect = (row: AdminCustomerRow) => {
    setCustomer(row);
    setGpuPlan(defaultGpuPlanFromCustomer(row));
  };

  const handleCustomerClear = () => {
    setCustomer(null);
    setGpuPlan('starter');
  };

  const handleSubmit = async () => {
    if (!customer?.userId) {
      setError('Vui lòng chọn khách hàng.');
      return;
    }
    if (!previewValid) {
      setError('Vui lòng nhập số giờ hợp lệ.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const res = await adminFetch('/api/admin/hour-grants', {
        method: 'POST',
        body: JSON.stringify({
          userId: customer.userId,
          hours: hoursNum,
          expiresAt: noExpiry ? null : expiresAt || null,
          internalNote,
          customerNote,
          gpuPlan,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Tặng giờ thất bại.');
        return;
      }
      onSuccess(`Đã tặng ${hoursNum} giờ gói ${gpuPlanDisplayName(gpuPlan)} cho ${customer.name}`);
      setCustomer(null);
      setHours('');
      setExpiresAt('');
      setNoExpiry(false);
      setInternalNote('');
      setCustomerNote('');
      setGpuPlan('starter');
    } catch {
      setError('Lỗi mạng khi tặng giờ.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hg-form-card">
      <h3>🎁 Tặng giờ mới</h3>

      <CustomerSearch
        label="Khách hàng"
        selected={customer}
        onSelect={handleCustomerSelect}
        onClear={handleCustomerClear}
      />

      <div className="hg-field">
        <label>Số giờ tặng</label>
        <input
          type="number"
          min={1}
          step={1}
          className="hg-input"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="VD: 10"
        />
      </div>

      <div className="hg-field">
        <label>Ngày hết hạn</label>
        <input
          type="date"
          className="hg-input"
          value={expiresAt}
          disabled={noExpiry}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
        <label className="hg-checkbox-row">
          <input
            type="checkbox"
            checked={noExpiry}
            onChange={(e) => setNoExpiry(e.target.checked)}
          />
          Không giới hạn
        </label>
      </div>

      <div className="hg-field">
        <label>Ghi chú nội bộ (chỉ Admin)</label>
        <textarea
          className="hg-textarea"
          value={internalNote}
          onChange={(e) => setInternalNote(e.target.value)}
          placeholder="Lý do tặng, campaign, v.v."
        />
      </div>

      <div className="hg-field">
        <label>Ghi chú cho khách hàng</label>
        <textarea
          className="hg-textarea"
          value={customerNote}
          onChange={(e) => setCustomerNote(e.target.value)}
          placeholder="Khách sẽ thấy trong Dashboard"
        />
      </div>

      <div className="hg-field">
        <label>🖥️ Cấu hình GPU</label>
        <div className="hg-gpu-plan-group">
          {GPU_PLAN_OPTIONS.map((option) => (
            <label key={option.key} className="hg-gpu-plan-row">
              <input
                type="radio"
                name="gpu-plan"
                checked={gpuPlan === option.key}
                onChange={() => setGpuPlan(option.key)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      {previewValid && (
        <div className="hg-preview">
          <strong>Preview:</strong> Tặng <strong>{hoursNum} giờ</strong> gói{' '}
          <strong>{gpuPlanShortLabel(gpuPlan)}</strong> cho <strong>{customer!.name}</strong>
          <br />
          Tương đương <strong>{formatCurrency(equivalentValue)}</strong>
          <br />
          Hết hạn: <strong>{noExpiry ? 'Không giới hạn' : formatDate(expiresAt || null)}</strong>
          {customerNote && (
            <>
              <br />
              Ghi chú KH: {customerNote}
            </>
          )}
        </div>
      )}

      {error && <p className="text-red" style={{ marginBottom: 12 }}>{error}</p>}

      <button type="button" className="btn btn-success" disabled={busy || !previewValid} onClick={() => void handleSubmit()}>
        {busy ? 'Đang xử lý...' : '🎁 Xác nhận tặng'}
      </button>
    </div>
  );
}

function AdjustTab({ onSuccess }: { onSuccess: (msg: string) => void }) {
  const [customer, setCustomer] = useState<AdminCustomerRow | null>(null);
  const [grants, setGrants] = useState<HourGrant[]>([]);
  const [selectedGrant, setSelectedGrant] = useState<HourGrant | null>(null);
  const [action, setAction] = useState<AdjustAction>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [loadingGrants, setLoadingGrants] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadGrants = useCallback(async (userId: string) => {
    setLoadingGrants(true);
    setError('');
    try {
      const res = await adminFetch(
        `/api/admin/hour-grants?scope=active&userId=${encodeURIComponent(userId)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Không tải được gói tặng.');
        setGrants([]);
        return;
      }
      setGrants(data.grants ?? []);
    } catch {
      setError('Lỗi mạng khi tải gói tặng.');
      setGrants([]);
    } finally {
      setLoadingGrants(false);
    }
  }, []);

  useEffect(() => {
    setSelectedGrant(null);
    setAction('add');
    setAmount('');
    setReason('');
    if (customer?.userId) {
      void loadGrants(customer.userId);
    } else {
      setGrants([]);
    }
  }, [customer, loadGrants]);

  const amountNum = Number.parseInt(amount, 10);
  const remaining = selectedGrant?.hours_remaining ?? 0;

  const preview = useMemo(() => {
    if (!selectedGrant || !customer) return null;
    if (action === 'revoke') {
      return remaining <= 0
        ? 'Không thể thu hồi — khách đã dùng hết giờ tặng.'
        : `Thu hồi toàn bộ ${remaining} giờ còn lại (giữ ${selectedGrant.hours_used} giờ đã dùng).`;
    }
    if (action === 'extend') {
      if (!Number.isFinite(amountNum) || amountNum <= 0) return null;
      const base = selectedGrant.expires_at ? new Date(selectedGrant.expires_at) : new Date();
      const extended = new Date(base.getTime() + amountNum * 24 * 60 * 60 * 1000);
      return `Gia hạn thêm ${amountNum} ngày → hết hạn ${formatDate(extended.toISOString())}.`;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) return null;
    if (action === 'add') {
      return `Thêm ${amountNum} giờ → tổng ${selectedGrant.hours_granted + amountNum} giờ (còn ${remaining + amountNum} giờ).`;
    }
    if (action === 'reduce') {
      if (amountNum > remaining) {
        return `Chỉ có thể giảm tối đa ${remaining} giờ chưa dùng.`;
      }
      return `Giảm ${amountNum} giờ → còn ${remaining - amountNum} giờ chưa dùng.`;
    }
    return null;
  }, [selectedGrant, customer, action, amountNum, remaining]);

  const canSubmit =
    selectedGrant &&
    reason.trim() &&
    (action === 'revoke'
      ? remaining > 0
      : action === 'extend'
        ? Number.isFinite(amountNum) && amountNum > 0
        : Number.isFinite(amountNum) &&
          amountNum > 0 &&
          (action !== 'reduce' || amountNum <= remaining));

  const handleSubmit = async () => {
    if (!selectedGrant || !canSubmit) return;

    setBusy(true);
    setError('');
    try {
      const res = await adminFetch('/api/admin/hour-grants', {
        method: 'PUT',
        body: JSON.stringify({
          grantId: selectedGrant.id,
          action,
          amount: action === 'revoke' ? remaining : amountNum,
          reason: reason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Điều chỉnh thất bại.');
        return;
      }
      onSuccess('Đã cập nhật gói tặng giờ');
      if (customer?.userId) {
        await loadGrants(customer.userId);
      }
      setSelectedGrant(null);
      setAmount('');
      setReason('');
    } catch {
      setError('Lỗi mạng khi điều chỉnh.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hg-form-card">
      <h3>✏️ Điều chỉnh / Thu hồi</h3>

      <CustomerSearch
        label="Khách hàng"
        selected={customer}
        onSelect={setCustomer}
        onClear={() => setCustomer(null)}
      />

      {customer && (
        <>
          <div className="hg-selected-customer">
            <span>
              Gói hiện tại: <strong>{customer.plan}</strong> · Giờ còn trong gói:{' '}
              <strong>{customer.hoursLeft}</strong>
            </span>
          </div>

          {loadingGrants ? (
            <p className="text-muted">Đang tải gói tặng...</p>
          ) : grants.length === 0 ? (
            <p className="hg-empty">Khách chưa có gói tặng giờ active.</p>
          ) : (
            <div className="hg-grant-list">
              {grants.map((grant) => (
                <button
                  key={grant.id}
                  type="button"
                  className={`hg-grant-item${selectedGrant?.id === grant.id ? ' selected' : ''}`}
                  onClick={() => setSelectedGrant(grant)}
                >
                  <div className="hg-grant-item-head">
                    <span>Gói #{grant.id} · {gpuPlanShortLabel(grant.gpu_plan)}</span>
                    <span>{formatDate(grant.created_at)}</span>
                  </div>
                  <div className="hg-grant-item-meta">
                    Cấu hình: <strong>{gpuPlanShortLabel(grant.gpu_plan)}</strong>
                    <br />
                    Tặng: {grant.hours_granted}h · Đã dùng: {grant.hours_used}h · Còn:{' '}
                    <strong>{grant.hours_remaining}h</strong>
                    <br />
                    Hết hạn: {formatDate(grant.expires_at)}
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedGrant && (
            <>
              <div className="hg-selected-customer">
                <span>
                  Cấu hình GPU gói tặng:{' '}
                  <strong>{gpuPlanShortLabel(selectedGrant.gpu_plan)}</strong> (không thể đổi khi
                  điều chỉnh)
                </span>
              </div>

              <div className="hg-field">
                <label>Hành động</label>
                <div className="hg-radio-group">
                  {(
                    [
                      ['add', 'Thêm giờ'],
                      ['reduce', 'Giảm giờ'],
                      ['revoke', 'Thu hồi toàn bộ'],
                      ['extend', 'Gia hạn thêm ngày'],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="hg-radio-row">
                      <input
                        type="radio"
                        name="adjust-action"
                        checked={action === value}
                        onChange={() => {
                          setAction(value);
                          setAmount('');
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {action !== 'revoke' && (
                <div className="hg-field">
                  <label>{action === 'extend' ? 'Số ngày gia hạn' : 'Số giờ thay đổi'}</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="hg-input"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              )}

              <div className="hg-field">
                <label>Lý do (nội bộ)</label>
                <textarea
                  className="hg-textarea"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Bắt buộc — ghi vào audit log"
                />
              </div>

              {preview && (
                <div className={`hg-preview${preview.includes('Không thể') || preview.includes('tối đa') ? '' : ''}`}>
                  <strong>Preview:</strong> {preview}
                </div>
              )}

              {error && <p className="text-red" style={{ marginBottom: 12 }}>{error}</p>}

              <button
                type="button"
                className="btn btn-success"
                disabled={busy || !canSubmit}
                onClick={() => void handleSubmit()}
              >
                {busy ? 'Đang xử lý...' : '✅ Xác nhận điều chỉnh'}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function HistoryTab() {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const limit = 10;

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (filter !== 'all') params.set('type', filter);

      const res = await adminFetch(`/api/admin/hour-grants?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Không tải được lịch sử.');
        return;
      }
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setError('Lỗi mạng khi tải lịch sử.');
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="hg-form-card">
      <h3>📋 Lịch sử tặng / điều chỉnh</h3>

      <div className="hg-history-filters">
        {HISTORY_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={`hg-filter-btn${filter === f.value ? ' active' : ''}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted">Đang tải...</p>
      ) : error ? (
        <p className="text-red">{error}</p>
      ) : items.length === 0 ? (
        <p className="hg-empty">Chưa có lịch sử.</p>
      ) : (
        <>
          <div className="hg-table-wrap">
            <table className="hg-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>KH</th>
                  <th>Hành động</th>
                  <th>Cấu hình</th>
                  <th>Giờ</th>
                  <th>Lý do</th>
                  <th>Admin</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const meta = actionMeta(row.actionType);
                  return (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.createdAt)}</td>
                      <td>
                        {row.customer ? (
                          <>
                            <strong>{row.customer.name}</strong>
                            <br />
                            <span className="text-muted">{row.customer.email}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <span className={`hg-action-badge ${meta.className}`}>
                          {meta.icon} {meta.label}
                        </span>
                      </td>
                      <td>{gpuPlanDisplayName(row.gpuPlan)}</td>
                      <td>
                        {row.actionType === 'extend'
                          ? `${row.amount ?? 0} ngày`
                          : row.amount != null
                            ? `${row.amount}h`
                            : '—'}
                      </td>
                      <td>{row.reason || '—'}</td>
                      <td>{row.admin?.name ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="hg-pagination">
            <span>
              Trang {page}/{totalPages} · {total} bản ghi
            </span>
            <div className="hg-pagination-btns">
              <button
                type="button"
                className="btn btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Trước
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Sau →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminHourGrantsPanel() {
  const [subTab, setSubTab] = useState<SubTab>('grant');
  const [toast, setToast] = useState('');
  const [toastError, setToastError] = useState(false);

  const showToast = (msg: string, isError = false) => {
    setToast(msg);
    setToastError(isError);
    window.setTimeout(() => setToast(''), 3500);
  };

  return (
    <div className="hg-panel">
      <div className="hg-subtabs">
        <button
          type="button"
          className={`hg-subtab${subTab === 'grant' ? ' active' : ''}`}
          onClick={() => setSubTab('grant')}
        >
          🎁 Tặng mới
        </button>
        <button
          type="button"
          className={`hg-subtab${subTab === 'adjust' ? ' active' : ''}`}
          onClick={() => setSubTab('adjust')}
        >
          ✏️ Điều chỉnh / Thu hồi
        </button>
        <button
          type="button"
          className={`hg-subtab${subTab === 'history' ? ' active' : ''}`}
          onClick={() => setSubTab('history')}
        >
          📋 Lịch sử
        </button>
      </div>

      {subTab === 'grant' && <GrantNewTab onSuccess={(msg) => showToast(msg)} />}
      {subTab === 'adjust' && <AdjustTab onSuccess={(msg) => showToast(msg)} />}
      {subTab === 'history' && <HistoryTab />}

      {toast && <div className={`hg-toast${toastError ? ' error' : ''}`}>{toast}</div>}
    </div>
  );
}
