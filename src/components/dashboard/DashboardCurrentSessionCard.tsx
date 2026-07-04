type SessionPhase = 'loading' | 'idle' | 'opening' | 'running' | 'stopping';



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

  sessionStatus: string | null;

  settlementStatus: string | null;

  verifiedRunningAt: string | null;

  idleMinutes: number | null;

  idleWarningActive: boolean;

  minutesUntilAutoStop: number | null;

  outputCount: number | null;

  outOfHours: boolean;

  lowCreditWarning: boolean;

};



export default function DashboardCurrentSessionCard({

  phase,

  sessionDurationSec,

  remainingHours,

  sessionStatus,

  settlementStatus,

  verifiedRunningAt,

  idleMinutes,

  idleWarningActive,

  minutesUntilAutoStop,

  outputCount,

  outOfHours,

  lowCreditWarning,

}: DashboardCurrentSessionCardProps) {

  return (

    <div className="card dashboard-session-card">

      <div className="card-header">

        <span className="card-title">⏱️ PHIÊN HIỆN TẠI</span>

        {sessionStatus && (

          <span className="dashboard-session-status-badge">{sessionStatus}</span>

        )}

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



        {phase === 'running' && (

          <>

            <div className="dashboard-session-timer" aria-live="polite">

              {formatRuntimeClock(sessionDurationSec)}

            </div>

            <div className="dashboard-session-timer-label">Thời gian phiên</div>



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



              {verifiedRunningAt && (

                <div className="dashboard-session-stat dashboard-session-muted">

                  ✓ Xác minh chạy: {new Date(verifiedRunningAt).toLocaleTimeString('vi-VN')}

                </div>

              )}



              {settlementStatus && (

                <div className="dashboard-session-stat dashboard-session-muted">

                  Settlement: {settlementStatus}

                </div>

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


