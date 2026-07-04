import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-session';

export type PendingStorageUpgrade = {
  id: string;
  user_id: string;
  current_ssd_gb: number;
  current_backup_gb: number;
  requested_ssd_gb: number;
  requested_backup_gb: number;
  price_change_per_month: number;
  total_amount: number;
  transfer_note: string | null;
  created_at: string;
  user: { email: string; phone: string | null } | null;
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

type AdminStoragePanelProps = {
  onCountChange?: (count: number) => void;
};

export default function AdminStoragePanel({ onCountChange }: AdminStoragePanelProps) {
  const [items, setItems] = useState<PendingStorageUpgrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const res = await adminFetch('/api/admin/storage/pending');
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Không tải được danh sách.');
        return;
      }

      const list = (data.items ?? []) as PendingStorageUpgrade[];
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

  const reject = async (id: string) => {
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

  if (loading) {
    return (
      <div className="card">
        <p className="text-muted">Đang tải yêu cầu bộ nhớ...</p>
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
          <div className="stat-label">Chờ duyệt bộ nhớ</div>
          <div className="stat-value text-amber">{items.length}</div>
          <div className="stat-sub">nâng cấp qua chuyển khoản</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="stat-label">Lưu ý</div>
          <div className="stat-sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
            Kiểm tra nội dung CK trước khi duyệt. SSD/Backup sẽ được cập nhật cho KH.
          </div>
        </div>
      </div>

      <div className="card-no-pad">
        <div className="card-header-row">
          <span className="fw-600 text-muted">
            Nâng cấp bộ nhớ chờ duyệt{' '}
            <span className="badge badge-amber" style={{ marginLeft: 8 }}>
              {items.length} yêu cầu
            </span>
          </span>
          <button type="button" className="btn btn-sm" onClick={loadPending}>
            Làm mới
          </button>
        </div>

        {items.length === 0 ? (
          <div className="empty-state">Không có yêu cầu bộ nhớ nào đang chờ duyệt</div>
        ) : (
          <div className="payments-list">
            {items.map((item) => {
              const busy = actionId === item.id;
              const email = item.user?.email ?? '—';
              const phone = item.user?.phone ?? '—';

              return (
                <article key={item.id} className="payment-card">
                  <div className="payment-card-head">
                    <div className="payment-card-title">
                      <span className="badge badge-blue">Bộ nhớ</span>
                      <span className="text-muted">
                        SSD {item.current_ssd_gb}→{item.requested_ssd_gb}GB
                      </span>
                      <span className="text-muted">
                        Backup {item.current_backup_gb}→{item.requested_backup_gb}GB
                      </span>
                      <span className="fw-600">
                        {new Intl.NumberFormat('vi-VN').format(Number(item.total_amount))}đ
                      </span>
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
                      <label>Thay đổi giá/tháng</label>
                      <p className="fw-600">
                        +{new Intl.NumberFormat('vi-VN').format(Number(item.price_change_per_month))}đ
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
                      {busy ? 'Đang xử lý...' : 'Duyệt — cập nhật gói'}
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
