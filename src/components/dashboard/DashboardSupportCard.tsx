import { useCallback, useEffect, useState } from 'react';

export type SupportSessionState = {
  id: number;
  userId: string;
  adminId: string | null;
  status: 'pending' | 'active' | 'ended';
  initiatedBy: 'customer' | 'admin';
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  remainingSeconds: number | null;
  expiresAt: string | null;
};

export const SUPPORT_SESSION_CHANGED_EVENT = 'support-session-changed';

export function notifySupportSessionChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SUPPORT_SESSION_CHANGED_EVENT));
  }
}

export function parseSupportSessionId(link: string | null): number | null {
  if (!link) return null;
  const match = link.match(/supportSession=(\d+)/);
  return match ? Number(match[1]) : null;
}

export function useSupportSessionStatus(accessToken: string | undefined) {
  const [session, setSession] = useState<SupportSessionState | null>(null);

  const loadStatus = useCallback(async () => {
    if (!accessToken) {
      setSession(null);
      return;
    }

    try {
      const res = await fetch('/api/support/status', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as { session?: SupportSessionState | null };
      if (res.ok) {
        setSession(data.session ?? null);
      }
    } catch {
      setSession(null);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!accessToken) return undefined;

    const onChange = () => void loadStatus();
    window.addEventListener(SUPPORT_SESSION_CHANGED_EVENT, onChange);
    const id = window.setInterval(() => void loadStatus(), 5000);
    return () => {
      window.removeEventListener(SUPPORT_SESSION_CHANGED_EVENT, onChange);
      window.clearInterval(id);
    };
  }, [accessToken, loadStatus]);

  return { session, reload: loadStatus };
}

function formatRemaining(seconds: number | null) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function DashboardSupportActiveBanner({
  session,
  accessToken,
  onEnded,
}: {
  session: SupportSessionState;
  accessToken: string | undefined;
  onEnded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(session.remainingSeconds ?? 0);

  useEffect(() => {
    setRemaining(session.remainingSeconds ?? 0);
  }, [session.remainingSeconds, session.id]);

  useEffect(() => {
    if (session.status !== 'active') return undefined;
    const id = window.setInterval(() => {
      setRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [session.status, session.id]);

  const endSupport = async () => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const res = await fetch('/api/support/end', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId: session.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Không kết thúc được phiên.');
      notifySupportSessionChanged();
      onEnded();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Không kết thúc được phiên.');
    } finally {
      setBusy(false);
    }
  };

  if (session.status !== 'active') return null;

  return (
    <div className="support-active-banner">
      <div className="support-active-banner-text">
        🔴 Admin đang xem phiên làm việc của bạn
        {remaining > 0 && (
          <span className="support-active-banner-timer"> · Còn {formatRemaining(remaining)}</span>
        )}
      </div>
      <button
        type="button"
        className="btn btn-sm btn-danger"
        disabled={busy}
        onClick={() => void endSupport()}
      >
        ❌ Ngừng chia sẻ
      </button>
    </div>
  );
}
