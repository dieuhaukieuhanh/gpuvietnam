import { useCallback, useEffect, useState } from 'react';
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

export type PendingSubscription = {
  id: string;
  user_id: string;
  plan: string;
  billing: string;
  env_name: string;
  env_icon: string;
  env_desc: string | null;
  gpu_label: string | null;
  hours_total: number;
  transfer_note: string | null;
  created_at: string;
  user: PendingUser | null;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortId(id: string) {
  return id.slice(0, 8);
}

type AdminPaymentsPanelProps = {
  onCountChange?: (count: number) => void;
};

export default function AdminPaymentsPanel({ onCountChange }: AdminPaymentsPanelProps) {
  const { plans } = useGpuPricingConfig();
  const checkoutPlans = resolveCheckoutPlans(plans);
  const [items, setItems] = useState<PendingSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const res = await adminFetch('/api/admin/subscriptions/pending');
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Không tải được danh sách.');
        return;
      }

      const list = (data.items ?? []) as PendingSubscription[];
      setItems(list);
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

  const approve = async (id: string) => {
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

  const reject = async (id: string) => {
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
          <div className="stat-sub">yêu cầu chuyển khoản</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="stat-label">Lưu ý</div>
          <div className="stat-sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
            So khớp nội dung CK với ghi chú bên dưới trước khi bấm Duyệt.
          </div>
        </div>
      </div>

      <div className="card-no-pad">
        <div className="card-header-row">
          <span className="fw-600 text-muted">
            Yêu cầu thanh toán chờ duyệt{' '}
            <span className="badge badge-amber" style={{ marginLeft: 8 }}>
              {items.length} yêu cầu
            </span>
          </span>
          <button type="button" className="btn btn-sm" onClick={loadPending}>
            Làm mới
          </button>
        </div>

        {items.length === 0 ? (
          <div className="empty-state">Không có yêu cầu nào đang chờ duyệt</div>
        ) : (
          <div className="payments-list">
            {items.map((item) => {
              const busy = actionId === item.id;
              const email = item.user?.email ?? '—';
              const phone = item.user?.phone ?? '—';
              const billingLabel =
                BILLING_LABELS[item.billing as BillingMode] ?? item.billing;
              const price = getCheckoutPlanPriceLabel(item.plan, item.billing, checkoutPlans);

              return (
                <article key={item.id} className="payment-card">
                  <div className="payment-card-head">
                    <div className="payment-card-title">
                      <span className="badge badge-blue">{item.plan}</span>
                      <span className="text-muted">{billingLabel}</span>
                      <span className="fw-600">{price}</span>
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
                      <label>Môi trường</label>
                      <p>
                        {item.env_icon} {item.env_name}
                      </p>
                    </div>
                    <div className="payment-field">
                      <label>GPU / Giờ</label>
                      <p>
                        {item.gpu_label ?? '—'}
                        <br />
                        <span className="fw-600">{item.hours_total}h</span>
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
                      onClick={() => approve(item.id)}
                    >
                      {busy ? 'Đang xử lý...' : 'Duyệt — kích hoạt gói'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => reject(item.id)}
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
    </>
  );
}
