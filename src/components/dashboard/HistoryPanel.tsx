import { useCallback, useEffect, useMemo, useState } from 'react';
import { USER_PLANS_CHANGED_EVENT } from '@/hooks/useUserPlans';
import { formatSessionDate, formatSessionTime } from '@/lib/gpu-sessions';
import {
  filterBillingHistorySessions,
  mapSessionApiToHistoryView,
  mapSessionsApiList,
} from '@/lib/scb-session-history-view-model';

type SessionApiRow = Record<string, unknown>;

type HistoryView = NonNullable<ReturnType<typeof mapSessionApiToHistoryView>>;

type SessionsResponse = {
  sessions: SessionApiRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

type HistoryPanelProps = {
  accessToken: string | undefined;
};

const PREVIEW_LIMIT = 7;
const RUNNING_POLL_MS = 30_000;

function SessionCard({ session }: { session: HistoryView }) {
  const statusClass = String(session.status ?? 'unknown');

  return (
    <div className="session-item">
      <div className="session-header">
        <div>
          <span className="session-number">#{session.sessionNumber}</span>
          <span style={{ color: 'var(--text-muted)', margin: '0 8px' }}>·</span>
          <span className="session-date">📅 {formatSessionDate(session.startedAt ?? '')}</span>
        </div>
        <span className={`session-status ${statusClass}`}>{session.statusLabel}</span>
      </div>

      <div className="session-details">
        <div className="session-detail">
          <span className="label">🖥️ Template:</span>
          <span className="value">{session.template}</span>
        </div>
        <div className="session-detail">
          <span className="label">⚡ Cấu hình:</span>
          <span className="value">{session.gpuConfig}</span>
        </div>
        <div className="session-detail">
          <span className="label">📦 Gói:</span>
          <span className="value">{session.billingLabel}</span>
        </div>
        <div className="session-detail">
          <span className="label">📊 VRAM TB:</span>
          <span className="value">{session.vramLabel}</span>
        </div>
      </div>

      <div className="session-divider" />

      <div className="session-details">
        <div className="session-detail">
          <span className="label">🔑 Bật máy:</span>
          <span className="value">
            {session.startedAt ? formatSessionTime(session.startedAt) : '—'}
          </span>
        </div>
        <div className="session-detail">
          <span className="label">⏹️ Tắt máy:</span>
          <span
            className="value"
            style={session.status === 'running' ? { color: 'var(--accent-blue)' } : undefined}
          >
            {session.endedAt ? formatSessionTime(session.endedAt) : '— Đang chạy —'}
          </span>
        </div>
        <div className="session-detail">
          <span className="label">⏱️ Thời lượng:</span>
          <span className="highlight">{session.durationLabel}</span>
        </div>
        {session.billableSeconds != null && (
          <div className="session-detail">
            <span className="label">💳 Thời gian tính phí:</span>
            <span className="highlight">{session.billableLabel}</span>
          </div>
        )}
        {session.settlementStatusLabel && (
          <div className="session-detail">
            <span className="label">📋 Quyết toán:</span>
            <span className="value">{session.settlementStatusLabel}</span>
          </div>
        )}
        {session.settlementAt && (
          <div className="session-detail">
            <span className="label">🕐 Quyết toán lúc:</span>
            <span className="value">{formatSessionTime(session.settlementAt)}</span>
          </div>
        )}
        {session.settlementBreakdownSummary && (
          <div className="session-detail">
            <span className="label">📊 Chi tiết quyết toán:</span>
            <span className="value">{session.settlementBreakdownSummary}</span>
          </div>
        )}
        {session.verifyStatusLabel && (
          <div className="session-detail">
            <span className="label">✅ Xác minh:</span>
            <span className="value">{session.verifyStatusLabel}</span>
          </div>
        )}
        {session.verifiedRunningAt && (
          <div className="session-detail">
            <span className="label">▶️ Verified running:</span>
            <span className="value">{formatSessionTime(session.verifiedRunningAt)}</span>
          </div>
        )}
        {session.verifiedDestroyedAt && (
          <div className="session-detail">
            <span className="label">🛑 Verified destroyed:</span>
            <span className="value">{formatSessionTime(session.verifiedDestroyedAt)}</span>
          </div>
        )}
        {session.destroyReason && (
          <div className="session-detail">
            <span className="label">⚠️ Destroy reason:</span>
            <span className="value">{session.destroyReason}</span>
          </div>
        )}
        <div className="session-detail">
          <span className="label">🖼️ Output:</span>
          <span className="value">{session.outputSummary}</span>
        </div>
      </div>
    </div>
  );
}

export default function HistoryPanel({ accessToken }: HistoryPanelProps) {
  const [sessions, setSessions] = useState<HistoryView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const hasRunningSession = sessions.some((s) => s.status === 'running');

  const billingHistory = useMemo(
    () => filterBillingHistorySessions(sessions),
    [sessions],
  );

  const loadSessions = useCallback(
    async (limit: number, offset: number, append: boolean) => {
      if (!accessToken) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/user/sessions?limit=${limit}&offset=${offset}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data: SessionsResponse & { error?: string } = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Không tải được lịch sử phiên.');

        const mapped = mapSessionsApiList(data.sessions ?? []);
        setTotal(data.total ?? 0);
        setSessions((prev) => (append ? [...prev, ...mapped] : mapped));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không tải được lịch sử phiên.');
        if (!append) setSessions([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    loadSessions(PREVIEW_LIMIT, 0, false);
  }, [loadSessions]);

  useEffect(() => {
    if (!accessToken) return undefined;
    const refresh = () => {
      void loadSessions(showAll ? 100 : PREVIEW_LIMIT, 0, false);
    };
    window.addEventListener(USER_PLANS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(USER_PLANS_CHANGED_EVENT, refresh);
  }, [accessToken, loadSessions, showAll]);

  useEffect(() => {
    if (!hasRunningSession || !accessToken) return undefined;
    const timer = window.setInterval(() => {
      void loadSessions(showAll ? 100 : PREVIEW_LIMIT, 0, false);
    }, RUNNING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [hasRunningSession, accessToken, loadSessions, showAll]);

  const handleShowAll = async () => {
    setShowAll(true);
    await loadSessions(100, 0, false);
  };

  const handleLoadMore = async () => {
    await loadSessions(50, sessions.length, true);
  };

  const hasMore = sessions.length < total;

  return (
    <div className="history-panel">
      <h1 className="page-title">📜 Lịch sử phiên</h1>
      <p className="page-subtitle">
        Theo dõi chi tiết từng phiên làm việc — dữ liệu quyết toán từ API, không tính phí trên trình
        duyệt
      </p>

      <div className="card">
        <div className="card-header">
          <span>
            {showAll
              ? `TẤT CẢ PHIÊN (${total})`
              : `PHIÊN GẦN NHẤT${total > 0 ? ` (${Math.min(PREVIEW_LIMIT, total)}/${total})` : ''}`}
          </span>
          {!showAll && total > PREVIEW_LIMIT && (
            <button type="button" className="view-all history-view-all-btn" onClick={handleShowAll}>
              Xem tất cả ({total} phiên) →
            </button>
          )}
        </div>

        {loading ? (
          <p className="history-empty">Đang tải...</p>
        ) : error ? (
          <p className="history-error">{error}</p>
        ) : sessions.length === 0 ? (
          <p className="history-empty">
            Chưa có phiên làm việc nào. Khi bạn bật máy GPU và sử dụng dịch vụ, lịch sử sẽ hiển thị tại
            đây.
          </p>
        ) : (
          <>
            {sessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}

            {showAll && hasMore && (
              <button
                type="button"
                className="view-all-link history-load-more"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Đang tải...' : `📂 Tải thêm (${sessions.length}/${total}) →`}
              </button>
            )}

            {!showAll && total > PREVIEW_LIMIT && (
              <button type="button" className="view-all-link" onClick={handleShowAll}>
                📂 Xem tất cả lịch sử ({total} phiên) →
              </button>
            )}
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <span>LỊCH SỬ QUYẾT TOÁN ({billingHistory.length})</span>
        </div>
        {loading ? (
          <p className="history-empty">Đang tải...</p>
        ) : billingHistory.length === 0 ? (
          <p className="history-empty">
            Chưa có phiên đã quyết toán. Phiên đã settle hoặc skip sẽ hiển thị tại đây.
          </p>
        ) : (
          billingHistory.map((session) => <SessionCard key={`billing-${session.id}`} session={session} />)
        )}
      </div>
    </div>
  );
}
