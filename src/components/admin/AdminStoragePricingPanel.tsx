import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-session';
import AdminBackupIntervalsPanel from '@/components/admin/AdminBackupIntervalsPanel';

export type StoragePricingRow = {
  id: string;
  storage_type: 'ssd' | 'backup';
  size_gb: number;
  price_monthly: number;
  is_active: boolean;
  updated_at: string;
};

function formatVnd(amount: number) {
  return new Intl.NumberFormat('vi-VN').format(amount);
}

function parsePriceInput(value: string) {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

type PricingTableProps = {
  title: string;
  rows: StoragePricingRow[];
  draftPrices: Record<string, string>;
  savingId: string | null;
  togglingId: string | null;
  onDraftChange: (id: string, value: string) => void;
  onSave: (row: StoragePricingRow) => void;
  onToggle: (row: StoragePricingRow) => void;
};

function PricingTable({
  title,
  rows,
  draftPrices,
  savingId,
  togglingId,
  onDraftChange,
  onSave,
  onToggle,
}: PricingTableProps) {
  return (
    <div className="pricing-section card-no-pad">
      <div className="card-header-row">
        <span className="fw-600">{title}</span>
      </div>
      <div className="table-wrap">
        <table className="pricing-table">
          <thead>
            <tr>
              <th>Dung lượng</th>
              <th>Giá/tháng (VNĐ)</th>
              <th>Trạng thái</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const busy = savingId === row.id || togglingId === row.id;
              const draft = draftPrices[row.id] ?? formatVnd(row.price_monthly);
              const priceChanged = parsePriceInput(draft) !== Number(row.price_monthly);

              return (
                <tr key={row.id} className={index % 2 === 1 ? 'pricing-row-alt' : ''}>
                  <td>
                    <strong>{row.size_gb} GB</strong>
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="pricing-price-input"
                      value={draft}
                      disabled={busy}
                      onChange={(e) => onDraftChange(row.id, e.target.value)}
                      onBlur={() => {
                        const parsed = parsePriceInput(draft);
                        onDraftChange(row.id, formatVnd(parsed));
                      }}
                      aria-label={`Giá ${row.size_gb}GB`}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`pricing-status-badge${row.is_active ? ' active' : ' inactive'}`}
                      disabled={busy}
                      onClick={() => onToggle(row)}
                      title="Bấm để đổi trạng thái"
                    >
                      {row.is_active ? '🟢 Đang áp dụng' : '⚫ Tạm ngưng'}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm btn-success"
                      disabled={busy || !priceChanged}
                      onClick={() => onSave(row)}
                    >
                      {savingId === row.id ? 'Đang lưu...' : 'Lưu'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminStoragePricingPanel() {
  const [items, setItems] = useState<StoragePricingRow[]>([]);
  const [draftPrices, setDraftPrices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const loadPricing = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/storage-pricing');
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Không tải được bảng giá.');
        return;
      }

      const list = (data.items ?? []) as StoragePricingRow[];
      setItems(list);
      setDraftPrices(
        Object.fromEntries(list.map((row) => [row.id, formatVnd(Number(row.price_monthly))])),
      );
    } catch {
      setError('Lỗi mạng khi tải bảng giá.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPricing();
  }, [loadPricing]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleDraftChange = (id: string, value: string) => {
    setDraftPrices((prev) => ({ ...prev, [id]: value }));
  };

  const handleSave = async (row: StoragePricingRow) => {
    const newPrice = parsePriceInput(draftPrices[row.id] ?? '');
    if (!Number.isFinite(newPrice) || newPrice < 0) {
      alert('Giá không hợp lệ.');
      return;
    }

    const oldPrice = Number(row.price_monthly);
    if (newPrice === oldPrice) return;

    setSavingId(row.id);
    try {
      const res = await adminFetch('/api/admin/storage-pricing', {
        method: 'PUT',
        body: JSON.stringify({ id: row.id, price_monthly: newPrice }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? 'Lưu thất bại.');
        return;
      }

      const updated = data.item as StoragePricingRow;
      setItems((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
      setDraftPrices((prev) => ({ ...prev, [row.id]: formatVnd(updated.price_monthly) }));

      const typeLabel = row.storage_type === 'ssd' ? 'SSD' : 'Backup';
      setToast(
        `Đã cập nhật giá ${typeLabel} ${row.size_gb}GB: ${formatVnd(oldPrice)}đ → ${formatVnd(newPrice)}đ`,
      );
    } catch {
      alert('Lỗi mạng khi lưu.');
    } finally {
      setSavingId(null);
    }
  };

  const handleToggle = async (row: StoragePricingRow) => {
    const nextActive = !row.is_active;
    const label = nextActive ? 'bật' : 'tạm ngưng';
    if (!confirm(`${nextActive ? 'Bật' : 'Tạm ngưng'} mức ${row.size_gb}GB ${row.storage_type === 'ssd' ? 'SSD' : 'Backup'}?`)) {
      return;
    }

    setTogglingId(row.id);
    try {
      const res = await adminFetch('/api/admin/storage-pricing', {
        method: 'PUT',
        body: JSON.stringify({ id: row.id, is_active: nextActive }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? 'Cập nhật trạng thái thất bại.');
        return;
      }

      const updated = data.item as StoragePricingRow;
      setItems((prev) => prev.map((r) => (r.id === row.id ? updated : r)));

      const typeLabel = row.storage_type === 'ssd' ? 'SSD' : 'Backup';
      setToast(`Đã ${label} mức ${typeLabel} ${row.size_gb}GB`);
    } catch {
      alert('Lỗi mạng khi cập nhật trạng thái.');
    } finally {
      setTogglingId(null);
    }
  };

  const ssdRows = items.filter((r) => r.storage_type === 'ssd');
  const backupRows = items.filter((r) => r.storage_type === 'backup');

  if (loading) {
    return (
      <div className="card">
        <p className="text-muted">Đang tải bảng giá bộ nhớ...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <p className="text-red">{error}</p>
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={loadPricing}>
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <>
      <AdminBackupIntervalsPanel />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="stat-label">Quản lý giá</div>
        <div className="stat-sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Sửa giá trực tiếp trong ô input rồi bấm <strong>Lưu</strong>. Bấm badge trạng thái để
          bật/tắt mức giá — khách hàng chỉ thấy mức <strong>Đang áp dụng</strong>.
        </div>
      </div>

      <div className="pricing-grid">
        <PricingTable
          title="⚡ SSD dùng ngay"
          rows={ssdRows}
          draftPrices={draftPrices}
          savingId={savingId}
          togglingId={togglingId}
          onDraftChange={handleDraftChange}
          onSave={handleSave}
          onToggle={handleToggle}
        />
        <PricingTable
          title="☁️ Backup"
          rows={backupRows}
          draftPrices={draftPrices}
          savingId={savingId}
          togglingId={togglingId}
          onDraftChange={handleDraftChange}
          onSave={handleSave}
          onToggle={handleToggle}
        />
      </div>

      {toast && (
        <div className="admin-pricing-toast" role="status" aria-live="polite">
          ✓ {toast}
        </div>
      )}
    </>
  );
}
