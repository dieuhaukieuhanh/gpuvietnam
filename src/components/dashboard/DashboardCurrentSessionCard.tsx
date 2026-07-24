import {
  formatDisplayHours,
  formatRuntimeClock,
  formatSessionElapsedLabel,
  type SessionPhase,
  type TimerDisplayMode,
} from '@/lib/dashboard-session-display';

type DashboardCurrentSessionCardProps = {
  phase: SessionPhase;
  timerMode: TimerDisplayMode;
  sessionDurationSec: number;
  remainingHours: number | null;
  billingStarted: boolean;
  idleMinutes: number | null;
  idleWarningActive: boolean;
  minutesUntilAutoStop: number | null;
  outputCount: number | null;
  outOfHours: boolean;
  lowCreditWarning: boolean;
  statusMessage?: string | null;
  stopPostCheckActive?: boolean;
};

function timerClassName(mode: TimerDisplayMode): string {
  if (mode === 'live') return 'dashboard-session-timer dashboard-session-timer--live';
  if (mode === 'paused') return 'dashboard-session-timer dashboard-session-timer--paused';
  if (mode === 'muted') return 'dashboard-session-timer dashboard-session-timer--muted';
  return 'dashboard-session-timer dashboard-session-timer--hidden';
}

function timerLabel(
  mode: TimerDisplayMode,
  phase: SessionPhase,
  billingStarted: boolean,
  stopPostCheckActive: boolean,
): string | null {
  if (phase === 'opening') return 'Chưa bắt đầu tính giờ';
  if (phase === 'running' && !billingStarted) return 'Chờ xác nhận billing từ server';
  if (mode === 'live') return null;
  if (mode === 'live' && (phase === 'disconnected' || phase === 'error')) {
    return 'Đang tính giờ — Generate tạm gián đoạn, đang khôi phục máy';
  }
  if (mode === 'paused' && phase === 'disconnected') return 'Thời gian phiên (tạm dừng hiển thị)';
  if (mode === 'paused' && phase === 'stopping') {
    return stopPostCheckActive
      ? 'Đang xác nhận tắt máy · timer dừng'
      : 'Đang lưu dữ liệu · timer dừng';
  }
  if (mode === 'muted') return 'Timer chưa chạy';
  return null;
}

export default function DashboardCurrentSessionCard({
  phase,
  timerMode,
  sessionDurationSec,
  remainingHours,
  billingStarted,
  idleMinutes,
  idleWarningActive,
  minutesUntilAutoStop,
  outputCount,
  outOfHours,
  lowCreditWarning,
  statusMessage,
  stopPostCheckActive = false,
}: DashboardCurrentSessionCardProps) {
  const showStats =
    phase === 'running' ||
    ((phase === 'disconnected' || phase === 'stopping' || phase === 'error') &&
      billingStarted);

  const showTimer = timerMode !== 'hidden';
  const timerSeconds = timerMode === 'muted' && phase !== 'stopping' ? 0 : sessionDurationSec;
  const timerCaption = timerLabel(timerMode, phase, billingStarted, stopPostCheckActive);

  const primaryAlert =
    phase === 'running' && outOfHours
      ? { type: 'danger' as const, text: '⏰ Máy sẽ tắt ngay khi hết giờ gói đang dùng' }
      : phase === 'running' && lowCreditWarning
        ? {
            type: 'warning' as const,
            text: '⚠️ Gói đang dùng còn ≤ 30 phút — máy sẽ tự tắt khi hết giờ gói này',
          }
        : phase === 'running' && idleWarningActive && minutesUntilAutoStop != null
          ? {
              type: 'warning' as const,
              text: `⚠️ Máy sẽ tự tắt sau ${minutesUntilAutoStop} phút nếu không có hoạt động`,
            }
          : null;

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

        {phase === 'running' && !billingStarted && (
          <p className="dashboard-session-callout dashboard-session-callout--warn">
            Đang xác nhận phiên — giây lát nữa sẽ bắt đầu tính giờ
          </p>
        )}

        {phase === 'stopping' && (
          <p className="dashboard-session-callout">
            {stopPostCheckActive
              ? '🔎 Đang xác nhận máy đã tắt — timer tạm dừng'
              : '💾 Đang lưu dữ liệu trước khi tắt máy — timer tạm dừng'}
          </p>
        )}

        {phase === 'disconnected' && (
          <p className="dashboard-session-callout dashboard-session-callout--warn">
            ⚠️ {statusMessage ?? 'Mất kết nối tạm thời — đang thử kết nối lại...'}
          </p>
        )}

        {phase === 'error' && (
          <p className="dashboard-session-callout dashboard-session-callout--error">
            ❌ {statusMessage ?? 'Phiên gặp lỗi — vui lòng thử đóng phiên hoặc mở lại.'}
          </p>
        )}

        {showTimer && (
          <div className="dashboard-session-timer-block">
            <div className={timerClassName(timerMode)} aria-live="polite">
              {formatRuntimeClock(timerSeconds)}
            </div>
            {timerCaption && (
              <div className="dashboard-session-timer-label">{timerCaption}</div>
            )}
          </div>
        )}

        {showStats && (
          <div className="dashboard-session-stats">
            {remainingHours != null ? (
              <div className="dashboard-session-stat">
                Còn{' '}
                <strong className="dashboard-session-stat-strong">
                  {formatDisplayHours(remainingHours)}
                </strong>{' '}
                sử dụng
              </div>
            ) : (
              <div className="dashboard-session-stat dashboard-session-muted">Đang tải giờ...</div>
            )}

            {billingStarted && sessionDurationSec > 0 && (
              <div className="dashboard-session-stat">
                Phiên này ~{formatSessionElapsedLabel(sessionDurationSec)}
              </div>
            )}

            {outputCount != null && outputCount > 0 && (
              <div className="dashboard-session-stat">🖼️ {outputCount} ảnh đã tạo</div>
            )}
          </div>
        )}
      </div>

      {primaryAlert && (
        <div className={`dashboard-session-alert dashboard-session-alert--${primaryAlert.type}`}>
          {primaryAlert.text}
        </div>
      )}
    </div>
  );
}
