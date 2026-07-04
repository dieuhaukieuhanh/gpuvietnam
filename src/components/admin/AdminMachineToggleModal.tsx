import { useCallback, useEffect, useState } from 'react';
import {
  formatSessionDurationShort,
  type AdminCustomerRow,
} from '@/lib/admin-customers-shared';
import { adminFetch } from '@/lib/admin-session';

export type AdminMachineLog = {
  id: number;
  admin_id: string | null;
  user_id: string;
  action: 'start' | 'stop';
  machine_id: string | null;
  reason: string | null;
  created_at: string;
};

export type MachineToggleAction = 'start' | 'stop';

export function getMachineToggleAction(row: AdminCustomerRow): MachineToggleAction | null {
  if (!row.userId) return null;
  if (row.isOnline || row.machinesRunning > 0) return 'stop';
  if (row.hoursLeft > 0 && row.realtimeStatus !== 'expired') return 'start';
  return null;
}

function machineStatusLabel(row: AdminCustomerRow, now: number) {
  if (row.isOnline || row.machinesRunning > 0) {
    const seconds =
      row.sessionStartedAt != null
        ? Math.max(
            0,
            Math.floor((now - new Date(row.sessionStartedAt).getTime()) / 1000),
          )
        : row.currentSessionDuration;
    const duration = formatSessionDurationShort(seconds);
    return `Đang chạy · ${duration}`;
  }
  if (row.hoursLeft > 0) return 'Offline · có gói active';
  return 'Không có máy';
}

type AdminMachineToggleModalProps = {
  open: boolean;
  customer: AdminCustomerRow | null;
  action: MachineToggleAction | null;
  now: number;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onBusyChange?: (userId: string | null) => void;
};

export default function AdminMachineToggleModal({
  open,
  customer,
  action,
  now,
  onClose,
  onSuccess,
  onBusyChange,
}: AdminMachineToggleModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setError('');
      setBusy(false);
    }
  }, [open]);

  const confirm = useCallback(async () => {
    if (!customer?.userId || !action) return;

    setBusy(true);
    onBusyChange?.(customer.userId);
    setError('');
    try {
      const res = await adminFetch('/api/admin/machines/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: customer.userId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Không thực hiện được thao tác.');

      onSuccess(
        action === 'stop'
          ? 'Đã tắt máy'
          : data.alreadyOnline
            ? 'Máy đang chạy'
            : 'Đang khởi động máy...',
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thực hiện được thao tác.');
      onBusyChange?.(null);
    } finally {
      setBusy(false);
    }
  }, [action, customer, onBusyChange, onClose, onSuccess]);

  if (!open || !customer || !action) return null;

  const sessionSeconds =
    customer.sessionStartedAt != null
      ? Math.max(0, Math.floor((now - new Date(customer.sessionStartedAt).getTime()) / 1000))
      : customer.currentSessionDuration;

  const title = action === 'stop' ? 'Tắt máy GPU?' : 'Khởi động máy GPU?';
  const body =
    action === 'stop'
      ? `Tắt máy của ${customer.name}? Máy đang chạy ${formatSessionDurationShort(sessionSeconds)}.`
      : `Khởi động máy cho ${customer.name}? Gói ${customer.plan}, còn ${customer.hoursLeft}h.`;

  return (
    <div
      className="modal-overlay active admin-support-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal admin-support-modal" role="dialog" aria-modal="true">
        <button type="button" className="close-btn" onClick={onClose} disabled={busy} aria-label="Đóng">
          ✕
        </button>
        <h3>{action === 'stop' ? '⏹️' : '🚀'} {title}</h3>
        <p className="admin-support-sub">{body}</p>
        {error && <p className="admin-support-warning">{error}</p>}
        <div className="machine-confirm-actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={onClose}>
            Hủy
          </button>
          <button
            type="button"
            className={`btn btn-sm ${action === 'stop' ? 'btn-danger' : 'btn-success'}`}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? 'Đang xử lý...' : action === 'stop' ? '⏹️ Tắt máy' : '🚀 Mở máy'}
          </button>
        </div>
      </div>
    </div>
  );
}

type AdminMachineManagementSectionProps = {
  row: AdminCustomerRow;
  now: number;
  toggleBusy: boolean;
  onToggle: (row: AdminCustomerRow, action: MachineToggleAction) => void;
};

export function AdminMachineManagementSection({
  row,
  now,
  toggleBusy,
  onToggle,
}: AdminMachineManagementSectionProps) {
  const [logs, setLogs] = useState<AdminMachineLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const toggleAction = getMachineToggleAction(row);

  useEffect(() => {
    if (!row.userId) return undefined;

    let cancelled = false;
    setLogsLoading(true);

    void (async () => {
      try {
        const res = await adminFetch(`/api/admin/machines/toggle?userId=${encodeURIComponent(row.userId!)}`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          setLogs(data.logs ?? []);
        }
      } catch {
        if (!cancelled) setLogs([]);
      } finally {
        if (!cancelled) setLogsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [row.userId, row.isOnline, row.machinesRunning]);

  return (
    <div className="customer-expand-machine">
      <div className="customer-detail-label" style={{ marginBottom: 8 }}>
        🖥️ Quản lý máy
      </div>
      <div className="customer-expand-machine-status">
        <span>{machineStatusLabel(row, now)}</span>
        {row.currentTemplate && (
          <span className="text-muted" style={{ marginLeft: 8 }}>
            · {row.currentTemplate}
          </span>
        )}
      </div>
      {toggleAction && (
        <div style={{ marginTop: 10, marginBottom: 12 }}>
          <button
            type="button"
            className={`btn btn-sm ${toggleAction === 'stop' ? 'btn-danger' : 'btn-success'}`}
            disabled={toggleBusy}
            onClick={() => onToggle(row, toggleAction)}
          >
            {toggleAction === 'stop' ? '⏹️ Tắt máy' : '🚀 Mở máy'}
          </button>
        </div>
      )}
      <div className="customer-detail-label" style={{ marginBottom: 6, fontSize: 11 }}>
        Lịch sử Admin can thiệp (3 lần gần nhất)
      </div>
      {logsLoading ? (
        <p className="text-muted" style={{ fontSize: 12 }}>Đang tải...</p>
      ) : logs.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 12 }}>Chưa có lịch sử can thiệp.</p>
      ) : (
        <ul className="customer-expand-machine-logs">
          {logs.map((log) => (
            <li key={log.id}>
              {log.action === 'start' ? '🚀 Mở máy' : '⏹️ Tắt máy'}
              {' · '}
              {new Date(log.created_at).toLocaleString('vi-VN')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MachineToggleButton({
  row,
  now,
  busy,
  compact = false,
  onToggle,
}: {
  row: AdminCustomerRow;
  now: number;
  busy: boolean;
  compact?: boolean;
  onToggle: (row: AdminCustomerRow, action: MachineToggleAction) => void;
}) {
  const action = getMachineToggleAction(row);
  if (!action) return null;

  if (action === 'stop') {
    return (
      <button
        type="button"
        className="btn btn-sm btn-danger"
        title={`Tắt máy · ${formatSessionDurationShort(
          row.sessionStartedAt
            ? Math.max(0, Math.floor((now - new Date(row.sessionStartedAt).getTime()) / 1000))
            : row.currentSessionDuration,
        )}`}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(row, 'stop');
        }}
      >
        {compact ? '⏹️' : '⏹️ Tắt máy'}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn btn-sm btn-success"
      title={`Mở máy · ${row.plan} · ${row.hoursLeft}h`}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(row, 'start');
      }}
    >
      {compact ? '🚀' : '🚀 Mở máy'}
    </button>
  );
}
