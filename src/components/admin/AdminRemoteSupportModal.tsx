import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminCustomerRow } from '@/lib/admin-customers-shared';
import { adminFetch } from '@/lib/admin-session';

type SupportSessionItem = {
  id: number;
  userId: string;
  adminId: string | null;
  status: 'pending' | 'active' | 'ended';
  initiatedBy: 'customer' | 'admin';
  startedAt: string | null;
  remainingSeconds: number | null;
  customerName: string;
  customerEmail: string | null;
};

type AdminRemoteSupportModalProps = {
  open: boolean;
  customer: AdminCustomerRow | null;
  onClose: () => void;
};

function formatRemaining(seconds: number | null) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AdminRemoteSupportModal({
  open,
  customer,
  onClose,
}: AdminRemoteSupportModalProps) {
  const [sessions, setSessions] = useState<SupportSessionItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [remaining, setRemaining] = useState(0);

  const session = useMemo(() => {
    if (!customer?.userId) return null;
    return sessions.find((s) => s.userId === customer.userId) ?? null;
  }, [sessions, customer?.userId]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await adminFetch('/api/support/sessions');
      const data = await res.json();
      if (!res.ok) return;
      setSessions(data.sessions ?? []);
    } catch {
      /* ignore poll errors */
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    void loadSessions();
    const id = window.setInterval(() => void loadSessions(), 4000);
    return () => window.clearInterval(id);
  }, [open, loadSessions]);

  useEffect(() => {
    setRemaining(session?.remainingSeconds ?? 0);
  }, [session?.remainingSeconds, session?.id]);

  useEffect(() => {
    if (!open || session?.status !== 'active') return undefined;
    const id = window.setInterval(() => setRemaining((prev) => Math.max(0, prev - 1)), 1000);
    return () => window.clearInterval(id);
  }, [open, session?.status, session?.id]);

  const sendRequest = async () => {
    if (!customer?.userId) {
      setMessage('Khách hàng chưa liên kết tài khoản hệ thống.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const res = await adminFetch('/api/admin/support/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: customer.userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Không gửi được yêu cầu.');
      setMessage(data.message ?? 'Đã gửi yêu cầu tới khách hàng. Họ sẽ phản hồi qua thông báo 🔔.');
      await loadSessions();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Không gửi được yêu cầu.');
    } finally {
      setBusy(false);
    }
  };

  const endSession = async () => {
    if (!session) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await adminFetch('/api/support/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Không kết thúc được phiên.');
      setMessage(data.message ?? 'Đã kết thúc phiên hỗ trợ.');
      await loadSessions();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Không kết thúc được phiên.');
    } finally {
      setBusy(false);
    }
  };

  if (!open || !customer) return null;

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

        <h3>👁 Hỗ trợ từ xa — {customer.name}</h3>
        <p className="admin-support-sub">
          Admin chỉ xem màn hình khách hàng. WebRTC thật sẽ được tích hợp sau.
        </p>

        {session?.status === 'active' && (
          <div className="admin-support-stream-placeholder">
            <div className="admin-support-stream-title">
              ✅ Đã kết nối với màn hình của {customer.name}
            </div>
            <p className="admin-support-stream-note">
              WebRTC sẽ được tích hợp sau — hiện đang ghi nhận phiên hỗ trợ #{session.id}.
            </p>
            <div className="admin-support-timer">
              ⏱️ Còn lại: <strong>{formatRemaining(remaining)}</strong> / 30:00
            </div>
            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void endSession()}>
              ❌ Kết thúc hỗ trợ
            </button>
          </div>
        )}

        {session?.status === 'pending' && session.initiatedBy === 'admin' && (
          <div className="admin-support-waiting">
            <p>⏳ Đang chờ khách hàng chấp nhận qua thông báo 🔔...</p>
            <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => void endSession()}>
              Hủy yêu cầu
            </button>
          </div>
        )}

        {!session && (
          <div className="admin-support-actions">
            <p>Chưa có phiên hỗ trợ mở với khách hàng này.</p>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy || !customer.userId}
              onClick={() => void sendRequest()}
            >
              {busy ? 'Đang gửi...' : '👁 Gửi yêu cầu hỗ trợ từ xa'}
            </button>
            {!customer.userId && (
              <p className="admin-support-warning">Khách demo chưa có userId — không gửi được yêu cầu thật.</p>
            )}
          </div>
        )}

        {message && <p className="admin-support-message">{message}</p>}
      </div>
    </div>
  );
}
