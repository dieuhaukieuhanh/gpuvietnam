import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGpuPricingConfig } from '@/hooks/useGpuPricingConfig';
import {
  BILLING_LABELS,
  getCheckoutPlanPriceLabel,
  resolveCheckoutPlans,
  type BillingMode,
} from '@/lib/checkout-plans';
import { adminFetch } from '@/lib/admin-session';

type PendingUser = {
  email: string;
  phone: string | null;
};

export type GpuPlanRequest = {
  type: 'gpu_plan';
  id: string;
  user_id: string;
  created_at: string;
  user: PendingUser | null;
  plan_name: string;
  plan: string;
  billing: string;
  env_name: string;
  env_icon: string;
  gpu_label: string | null;
  hours: number;
  hours_total: number;
  transfer_note: string | null;
};

export type StorageUpgradeRequest = {
  type: 'storage_upgrade';
  id: string;
  user_id: string;
  created_at: string;
  user: PendingUser | null;
  current_ssd_gb: number;
  current_backup_gb: number;
  requested_ssd_gb: number;
  requested_backup_gb: number;
  price_change_per_month: number;
  total_amount: number;
  payment_method: string | null;
  transfer_note: string | null;
};

export type WalletDepositRequest = {
  type: 'wallet_deposit';
  id: string;
  user_id: string;
  created_at: string;
  user: (PendingUser & { full_name?: string | null }) | null;
  amount: number;
  description: string | null;
  transfer_note: string;
};

export type PlanRenewRequest = {
  type: 'plan_renew';
  id: string;
  user_id: string;
  created_at: string;
  user: (PendingUser & { full_name?: string | null }) | null;
  plan_name: string;
  plan: string;
  billing: string;
  renew_price: number;
  transfer_amount: number;
  wallet_balance: number;
  hours_to_add: number;
  transfer_note: string;
};

export type PendingRequest =
  | GpuPlanRequest
  | StorageUpgradeRequest
  | WalletDepositRequest
  | PlanRenewRequest;

type RecentRequest = {
  type: 'gpu_plan' | 'storage_upgrade' | 'wallet_deposit' | 'plan_renew';
  id: string;
  user: PendingUser | null;
  outcome: 'approved' | 'rejected';
  processed_at: string;
  plan_name?: string;
  hours?: number;
  requested_ssd_gb?: number;
  requested_backup_gb?: number;
  total_amount?: number;
  amount?: number;
  renew_price?: number;
};

type FilterTab = 'all' | 'gpu_plan' | 'storage_upgrade' | 'wallet_deposit' | 'plan_renew';

function customerDisplayName(user: (PendingUser & { full_name?: string | null }) | null) {
  if (!user) return '—';
  if (user.full_name?.trim()) return user.full_name.trim();
  if (user.email) return user.email.split('@')[0];
  return '—';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat('vi-VN').format(Number(amount))}đ`;
}

function shortId(id: string) {
  return id.slice(0, 8);
}

type AdminPendingRequestsPanelProps = {
  onCountChange?: (count: number) => void;
};

export default function AdminPendingRequestsPanel({
  onCountChange,
}: AdminPendingRequestsPanelProps) {
  const { plans } = useGpuPricingConfig();
  const checkoutPlans = resolveCheckoutPlans(plans);
  const [items, setItems] = useState<PendingRequest[]>([]);
  const [recent, setRecent] = useState<RecentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [showRecent, setShowRecent] = useState(false);

  const loadPending = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const res = await adminFetch('/api/admin/pending-requests');
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Không tải được danh sách.');
        return;
      }

      const list = (data.items ?? []) as PendingRequest[];
      setItems(list);
      setRecent((data.recent ?? []) as RecentRequest[]);
      onCountChange?.(list.length);
    } catch {
      setError('Lỗi mạng khi tải danh sách.');
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((item) => item.type === filter);
  }, [items, filter]);

  const gpuCount = items.filter((i) => i.type === 'gpu_plan').length;
  const storageCount = items.filter((i) => i.type === 'storage_upgrade').length;
  const walletCount = items.filter((i) => i.type === 'wallet_deposit').length;
  const renewCount = items.filter((i) => i.type === 'plan_renew').length;

  const approveGpu = async (id: string) => {
    if (!confirm('Xác nhận đã nhận chuyển khoản và kích hoạt gói này?')) return;

    setActionId(id);
    try {
      const res = await adminFetch('/api/admin/subscriptions/approve', {
        method: 'POST',
        body: JSON.stringify({ subscriptionId: id }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? 'Duyệt thất bại.');
        return;
      }

      await loadPending();
    } catch {
      alert('Lỗi mạng khi duyệt.');
    } finally {
      setActionId(null);
    }
  };

  const rejectGpu = async (id: string) => {
    const reason = prompt('Lý do từ chối (tuỳ chọn):');
    if (reason === null) return;

    setActionId(id);
    try {
      const res = await adminFetch('/api/admin/subscriptions/reject', {
        method: 'POST',
        body: JSON.stringify({ subscriptionId: id, reason: reason || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? 'Từ chối thất bại.');
        return;
      }

      await loadPending();
    } catch {
      alert('Lỗi mạng khi từ chối.');
    } finally {
      setActionId(null);
    }
  };

  const approveStorage = async (id: string) => {
    if (!confirm('Xác nhận đã nhận chuyển khoản và cập nhật gói bộ nhớ?')) return;

    setActionId(id);
    try {
      const res = await adminFetch('/api/admin/storage/approve', {
        method: 'POST',
        body: JSON.stringify({ upgradeId: id }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? 'Duyệt thất bại.');
        return;
      }

      await loadPending();
    } catch {
      alert('Lỗi mạng khi duyệt.');
    } finally {
      setActionId(null);
    }
  };

  const rejectStorage = async (id: string) => {
    const reason = prompt('Lý do từ chối (tuỳ chọn):');
    if (reason === null) return;

    setActionId(id);
    try {
      const res = await adminFetch('/api/admin/storage/reject', {
        method: 'POST',
        body: JSON.stringify({ upgradeId: id, reason: reason || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? 'Từ chối thất bại.');
        return;
      }

      await loadPending();
    } catch {
      alert('Lỗi mạng khi từ chối.');
    } finally {
      setActionId(null);
    }
  };

  const approveWallet = async (id: string) => {
    if (!confirm('Xác nhận đã nhận chuyển khoản và cộng tiền vào Ví?')) return;

    setActionId(id);
    try {
      const res = await adminFetch('/api/admin/wallet-deposits/approve', {
        method: 'POST',
        body: JSON.stringify({ transactionId: id }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? 'Duyệt thất bại.');
        return;
      }

      await loadPending();
    } catch {
      alert('Lỗi mạng khi duyệt.');
    } finally {
      setActionId(null);
    }
  };

  const rejectWallet = async (id: string) => {
    const reason = prompt('Lý do từ chối (tuỳ chọn):');
    if (reason === null) return;

    setActionId(id);
    try {
      const res = await adminFetch('/api/admin/wallet-deposits/reject', {
        method: 'POST',
        body: JSON.stringify({ transactionId: id, reason: reason || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? 'Từ chối thất bại.');
        return;
      }

      await loadPending();
    } catch {
      alert('Lỗi mạng khi từ chối.');
    } finally {
      setActionId(null);
    }
  };

  const approveRenew = async (id: string) => {
    if (
      !confirm(
        'Xác nhận đã nhận chuyển khoản bổ sung? Hệ thống sẽ cộng Ví và thực hiện tái tục gói.',
      )
    ) {
      return;
    }

    setActionId(id);
    try {
      const res = await adminFetch('/api/admin/plan-renew/approve', {
        method: 'POST',
        body: JSON.stringify({ requestId: id }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? 'Duyệt tái tục thất bại.');
        return;
      }

      await loadPending();
    } catch {
      alert('Lỗi mạng khi duyệt.');
    } finally {
      setActionId(null);
    }
  };

  const rejectRenew = async (id: string) => {
    const reason = prompt('Lý do từ chối (tuỳ chọn):');
    if (reason === null) return;

    setActionId(id);
    try {
      const res = await adminFetch('/api/admin/plan-renew/reject', {
        method: 'POST',
        body: JSON.stringify({ requestId: id, reason: reason || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? 'Từ chối thất bại.');
        return;
      }

      await loadPending();
    } catch {
      alert('Lỗi mạng khi từ chối.');
    } finally {
      setActionId(null);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <p className="text-muted">Đang tải yêu cầu chờ duyệt...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <p className="text-red">{error}</p>
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={loadPending}>
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="stat-label">Chờ duyệt</div>
          <div className="stat-value text-amber">{items.length}</div>
          <div className="stat-sub">
            {gpuCount} gói GPU · {storageCount} bộ nhớ · {walletCount} nạp Ví · {renewCount} tái tục
          </div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="stat-label">Lưu ý</div>
          <div className="stat-sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
            So khớp nội dung chuyển khoản trước khi bấm Duyệt. Tái tục: cộng CK bổ sung vào Ví rồi trừ phí tái tục.
          </div>
        </div>
      </div>

      <div className="card-no-pad">
        <div className="card-header-row">
          <span className="fw-600 text-muted">
            Yêu cầu chờ duyệt{' '}
            <span className="badge badge-amber" style={{ marginLeft: 8 }}>
              {filteredItems.length} hiển thị
            </span>
          </span>
          <button type="button" className="btn btn-sm" onClick={loadPending}>
            Làm mới
          </button>
        </div>

        <div className="mini-tabs" style={{ padding: '0 16px', marginBottom: 0 }}>
          <button
            type="button"
            className={`mini-tab${filter === 'all' ? ' active' : ''}`}
            onClick={() => setFilter('all')}
          >
            Tất cả ({items.length})
          </button>
          <button
            type="button"
            className={`mini-tab${filter === 'gpu_plan' ? ' active' : ''}`}
            onClick={() => setFilter('gpu_plan')}
          >
            Gói GPU ({gpuCount})
          </button>
          <button
            type="button"
            className={`mini-tab${filter === 'storage_upgrade' ? ' active' : ''}`}
            onClick={() => setFilter('storage_upgrade')}
          >
            Bộ nhớ ({storageCount})
          </button>
          <button
            type="button"
            className={`mini-tab${filter === 'wallet_deposit' ? ' active' : ''}`}
            onClick={() => setFilter('wallet_deposit')}
          >
            Nạp Ví ({walletCount})
          </button>
          <button
            type="button"
            className={`mini-tab${filter === 'plan_renew' ? ' active' : ''}`}
            onClick={() => setFilter('plan_renew')}
          >
            Tái tục ({renewCount})
          </button>
        </div>

        {filteredItems.length === 0 ? (
          <div className="empty-state">Không có yêu cầu nào đang chờ duyệt</div>
        ) : (
          <div className="payments-list">
            {filteredItems.map((item) => {
              const busy = actionId === item.id;
              const email = item.user?.email ?? '—';
              const phone = item.user?.phone ?? '—';

              if (item.type === 'gpu_plan') {
                const billingLabel =
                  BILLING_LABELS[item.billing as BillingMode] ?? item.billing;
                const amount = getCheckoutPlanPriceLabel(item.plan_name, item.billing, checkoutPlans);

                return (
                  <article key={item.id} className="payment-card">
                    <div className="payment-card-head">
                      <div className="payment-card-title">
                        <span className="badge badge-red">Gói GPU</span>
                        <span className="badge badge-blue">{item.plan_name}</span>
                        <span className="text-muted">{billingLabel}</span>
                        <span className="fw-600">{amount}</span>
                        <span className="text-dim mono" title={item.id}>
                          #{shortId(item.id)}
                        </span>
                      </div>
                      <span className="payment-card-meta">{formatDate(item.created_at)}</span>
                    </div>

                    <div className="payment-card-grid">
                      <div className="payment-field">
                        <label>Khách hàng</label>
                        <p>
                          <strong>{email}</strong>
                          <br />
                          <span className="text-dim">{phone}</span>
                        </p>
                      </div>
                      <div className="payment-field">
                        <label>Gói / Giờ</label>
                        <p>
                          {item.plan_name}
                          <br />
                          <span className="fw-600">{item.hours}h</span>
                        </p>
                      </div>
                      <div className="payment-field">
                        <label>Số tiền</label>
                        <p className="fw-600">{amount}</p>
                      </div>
                      <div className="payment-field">
                        <label>Môi trường</label>
                        <p>
                          {item.env_icon} {item.env_name}
                        </p>
                      </div>
                      <div className="payment-field payment-field-full">
                        <label>Nội dung chuyển khoản</label>
                        <div className="payment-note">{item.transfer_note ?? '—'}</div>
                      </div>
                    </div>

                    <div className="payment-card-actions">
                      <button
                        type="button"
                        className="btn btn-success"
                        disabled={busy}
                        onClick={() => approveGpu(item.id)}
                      >
                        {busy ? 'Đang xử lý...' : 'Duyệt'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={busy}
                        onClick={() => rejectGpu(item.id)}
                      >
                        Từ chối
                      </button>
                    </div>
                  </article>
                );
              }

              if (item.type === 'wallet_deposit') {
                const displayName = customerDisplayName(item.user);

                return (
                  <article key={item.id} className="payment-card">
                    <div className="payment-card-head">
                      <div className="payment-card-title">
                        <span className="badge badge-green">💰 Nạp Ví</span>
                        <span className="fw-600">{displayName}</span>
                        <span className="fw-600">{formatMoney(item.amount)}</span>
                        <span className="text-dim mono" title={item.id}>
                          #{shortId(item.id)}
                        </span>
                      </div>
                      <span className="payment-card-meta">{formatDate(item.created_at)}</span>
                    </div>

                    <div className="payment-card-grid">
                      <div className="payment-field">
                        <label>Email</label>
                        <p>
                          <strong>{email}</strong>
                        </p>
                      </div>
                      <div className="payment-field">
                        <label>SĐT</label>
                        <p>{phone}</p>
                      </div>
                      <div className="payment-field">
                        <label>Số tiền</label>
                        <p className="fw-600">{formatMoney(item.amount)}</p>
                      </div>
                      <div className="payment-field">
                        <label>Thời gian</label>
                        <p>{formatDate(item.created_at)}</p>
                      </div>
                      {item.description && (
                        <div className="payment-field payment-field-full">
                          <label>Mô tả</label>
                          <div className="payment-note">{item.description}</div>
                        </div>
                      )}
                      <div className="payment-field payment-field-full">
                        <label>Nội dung chuyển khoản</label>
                        <div className="payment-note">{item.transfer_note}</div>
                      </div>
                    </div>

                    <div className="payment-card-actions">
                      <button
                        type="button"
                        className="btn btn-success"
                        disabled={busy}
                        onClick={() => approveWallet(item.id)}
                      >
                        {busy ? 'Đang xử lý...' : '✅ Duyệt'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={busy}
                        onClick={() => rejectWallet(item.id)}
                      >
                        ❌ Từ chối
                      </button>
                    </div>
                  </article>
                );
              }

              if (item.type === 'plan_renew') {
                const billingLabel =
                  BILLING_LABELS[item.billing as BillingMode] ?? item.billing;
                const displayName = customerDisplayName(item.user);

                return (
                  <article key={item.id} className="payment-card">
                    <div className="payment-card-head">
                      <div className="payment-card-title">
                        <span className="badge badge-blue">🔄 Tái tục</span>
                        <span className="badge badge-blue">{item.plan_name}</span>
                        <span className="text-muted">{billingLabel}</span>
                        <span className="fw-600">{formatMoney(item.transfer_amount)}</span>
                        <span className="text-dim mono" title={item.id}>
                          #{shortId(item.id)}
                        </span>
                      </div>
                      <span className="payment-card-meta">{formatDate(item.created_at)}</span>
                    </div>

                    <div className="payment-card-grid">
                      <div className="payment-field">
                        <label>Khách hàng</label>
                        <p>
                          <strong>{displayName}</strong>
                          <br />
                          <span className="text-dim">{email}</span>
                        </p>
                      </div>
                      <div className="payment-field">
                        <label>Phí tái tục</label>
                        <p className="fw-600">{formatMoney(item.renew_price)}</p>
                      </div>
                      <div className="payment-field">
                        <label>CK bổ sung</label>
                        <p className="fw-600">{formatMoney(item.transfer_amount)}</p>
                      </div>
                      <div className="payment-field">
                        <label>Số dư Ví hiện tại</label>
                        <p>{formatMoney(item.wallet_balance)}</p>
                      </div>
                      <div className="payment-field">
                        <label>Giờ cộng thêm</label>
                        <p className="fw-600">{item.hours_to_add}h</p>
                      </div>
                      <div className="payment-field payment-field-full">
                        <label>Nội dung chuyển khoản</label>
                        <div className="payment-note">{item.transfer_note}</div>
                      </div>
                    </div>

                    <div className="payment-card-actions">
                      <button
                        type="button"
                        className="btn btn-success"
                        disabled={busy}
                        onClick={() => approveRenew(item.id)}
                      >
                        {busy ? 'Đang xử lý...' : '✅ Duyệt tái tục'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={busy}
                        onClick={() => rejectRenew(item.id)}
                      >
                        ❌ Từ chối
                      </button>
                    </div>
                  </article>
                );
              }

              return (
                <article key={item.id} className="payment-card">
                  <div className="payment-card-head">
                    <div className="payment-card-title">
                      <span className="badge badge-amber">Nâng cấp bộ nhớ</span>
                      <span className="text-muted">
                        SSD {item.current_ssd_gb}→{item.requested_ssd_gb}GB
                      </span>
                      <span className="text-muted">
                        Backup {item.current_backup_gb}→{item.requested_backup_gb}GB
                      </span>
                      <span className="fw-600">{formatMoney(item.total_amount)}</span>
                      <span className="text-dim mono" title={item.id}>
                        #{shortId(item.id)}
                      </span>
                    </div>
                    <span className="payment-card-meta">{formatDate(item.created_at)}</span>
                  </div>

                  <div className="payment-card-grid">
                    <div className="payment-field">
                      <label>Khách hàng</label>
                      <p>
                        <strong>{email}</strong>
                        <br />
                        <span className="text-dim">{phone}</span>
                      </p>
                    </div>
                    <div className="payment-field">
                      <label>Dung lượng</label>
                      <p>
                        SSD: {item.current_ssd_gb}→{item.requested_ssd_gb} GB
                        <br />
                        Backup: {item.current_backup_gb}→{item.requested_backup_gb} GB
                      </p>
                    </div>
                    <div className="payment-field">
                      <label>Số tiền / Thanh toán</label>
                      <p>
                        <span className="fw-600">{formatMoney(item.total_amount)}</span>
                        <br />
                        <span className="text-dim">
                          {item.payment_method === 'transfer' ? 'Chuyển khoản' : item.payment_method ?? '—'}
                        </span>
                      </p>
                    </div>
                    <div className="payment-field payment-field-full">
                      <label>Nội dung chuyển khoản</label>
                      <div className="payment-note">{item.transfer_note ?? '—'}</div>
                    </div>
                  </div>

                  <div className="payment-card-actions">
                    <button
                      type="button"
                      className="btn btn-success"
                      disabled={busy}
                      onClick={() => approveStorage(item.id)}
                    >
                      {busy ? 'Đang xử lý...' : 'Duyệt'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => rejectStorage(item.id)}
                    >
                      Từ chối
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div className="card" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="recent-toggle"
            onClick={() => setShowRecent((v) => !v)}
            aria-expanded={showRecent}
          >
            <span className="fw-600 text-muted">Đã xử lý gần đây ({recent.length})</span>
            <span className="text-dim">{showRecent ? '▲ Thu gọn' : '▼ Mở rộng'}</span>
          </button>

          {showRecent && (
            <div className="recent-list">
              {recent.map((row) => {
                const email = row.user?.email ?? '—';
                const outcomeLabel = row.outcome === 'approved' ? 'Đã duyệt' : 'Từ chối';
                const outcomeClass =
                  row.outcome === 'approved' ? 'badge-green' : 'badge-red';

                return (
                  <div key={`${row.type}-${row.id}`} className="recent-row">
                    <div className="recent-row-main">
                      <span
                        className={`badge ${
                          row.type === 'gpu_plan'
                            ? 'badge-red'
                            : row.type === 'wallet_deposit'
                              ? 'badge-green'
                              : row.type === 'plan_renew'
                                ? 'badge-blue'
                                : 'badge-amber'
                        }`}
                      >
                        {row.type === 'gpu_plan'
                          ? 'Gói GPU'
                          : row.type === 'wallet_deposit'
                            ? 'Nạp Ví'
                            : row.type === 'plan_renew'
                              ? 'Tái tục'
                              : 'Bộ nhớ'}
                      </span>
                      <span className={`badge ${outcomeClass}`}>{outcomeLabel}</span>
                      <span>{email}</span>
                      {row.type === 'gpu_plan' ? (
                        <span className="text-muted">
                          {row.plan_name} · {row.hours}h
                        </span>
                      ) : row.type === 'wallet_deposit' ? (
                        <span className="text-muted">{formatMoney(row.amount ?? 0)}</span>
                      ) : row.type === 'plan_renew' ? (
                        <span className="text-muted">
                          {row.plan_name} · +{row.hours}h · {formatMoney(row.renew_price ?? 0)}
                        </span>
                      ) : (
                        <span className="text-muted">
                          SSD {row.requested_ssd_gb}GB · Backup {row.requested_backup_gb}GB ·{' '}
                          {formatMoney(row.total_amount ?? 0)}
                        </span>
                      )}
                    </div>
                    <span className="text-dim" style={{ fontSize: 11 }}>
                      {formatDate(row.processed_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
