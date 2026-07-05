type SessionPhase =
  | 'loading'
  | 'idle'
  | 'opening'
  | 'running'
  | 'stopping'
  | 'disconnected'
  | 'error';

function formatRuntimeClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatIdleMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.floor(totalMinutes));
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h${m}p` : `${h}h`;
  }
  return `${minutes} phút`;
}

type DashboardCurrentSessionCardProps = {
  phase: SessionPhase;
  sessionDurationSec: number;
  remainingHours: number | null;
  idleMinutes: number | null;
  idleWarningActive: boolean;
  minutesUntilAutoStop: number | null;
  outputCount: number | null;
  outOfHours: boolean;
  lowCreditWarning: boolean;
  statusMessage?: string | null;
};

export default function DashboardCurrentSessionCard({
  phase,
  sessionDurationSec,
  remainingHours,
  idleMinutes,
  idleWarningActive,
  minutesUntilAutoStop,
  outputCount,
  outOfHours,
  lowCreditWarning,
  statusMessage,
}: DashboardCurrentSessionCardProps) {
  const showSessionStats =
    phase === 'running' || phase === 'disconnected' || phase === 'error';

  return (
    <div className="card dashboard-session-card">
      <div className="card-header">
        <span className="card-title">⏱️ PHIÊN HIỆN TẠI</span>
      </div>

      <div className="dashboard-session-body">
        {phase === 'idle' && (
          <p className="dashboard-session-muted">Chưa mở phiên làm việc.</p>
        )}
        {phase === 'loading' && (
          <p className="dashboard-session-muted">⏳ Đang đồng bộ trạng thái phiên...</p>
        )}

        {phase === 'opening' && (
          <p className="dashboard-session-muted">⏳ Đang khởi tạo phiên làm việc...</p>
        )}

        {phase === 'stopping' && (
          <p className="dashboard-session-muted">⏳ Đang đóng phiên làm việc...</p>
        )}

        {phase === 'disconnected' && (
          <p className="dashboard-session-muted">
            ⚠️ {statusMessage ?? 'Mất kết nối tạm thời — đang thử kết nối lại...'}
          </p>
        )}

        {phase === 'error' && (
          <p className="dashboard-session-muted">
            ❌ {statusMessage ?? 'Phiên gặp lỗi — vui lòng thử đóng phiên hoặc mở lại.'}
          </p>
        )}

        {showSessionStats && (
          <>
            <div className="dashboard-session-timer" aria-live="polite">
              {formatRuntimeClock(sessionDurationSec)}
            </div>
            <div className="dashboard-session-timer-label">
              {phase === 'running' ? 'Thời gian phiên' : 'Thời gian phiên (tạm dừng)'}
            </div>

            <div className="dashboard-session-stats">
              {remainingHours != null ? (
                <div className="dashboard-session-stat">
                  Còn{' '}
                  <strong style={{ color: 'var(--accent-blue)' }}>
                    {remainingHours.toFixed(2)}h
                  </strong>{' '}
                  sử dụng
                </div>
              ) : (
                <div className="dashboard-session-stat dashboard-session-muted">Đang tải giờ...</div>
              )}

              {idleMinutes != null && idleMinutes > 0 && (
                <div className="dashboard-session-stat">
                  🕐 Không sử dụng: {formatIdleMinutes(idleMinutes)}
                </div>
              )}

              {outputCount != null && (
                <div className="dashboard-session-stat">🖼️ {outputCount} ảnh đã tạo</div>
              )}
            </div>
          </>
        )}
      </div>

      {phase === 'running' && idleWarningActive && minutesUntilAutoStop != null && (
        <div
          className="alert-card warning"
          style={{ display: 'flex', marginTop: 12, padding: '10px 12px', fontSize: 12 }}
        >
          <span className="alert-icon">⚠️</span>
          <div className="alert-content">
            <div className="alert-desc">
              Máy sẽ tự tắt sau {minutesUntilAutoStop} phút nếu không có hoạt động
            </div>
          </div>
        </div>
      )}

      {phase === 'running' && (outOfHours || lowCreditWarning) && (
        <div
          className="alert-card danger"
          style={{ display: 'flex', marginTop: 12, padding: '10px 12px', fontSize: 12 }}
        >
          <span className="alert-icon">⏰</span>
          <div className="alert-content">
            <div className="alert-desc">Máy sẽ tắt ngay khi hết giờ</div>
          </div>
        </div>
      )}
    </div>
  );
}
