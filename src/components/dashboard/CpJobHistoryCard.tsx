import { useCallback, useEffect, useState } from 'react';

type HistoryJob = {
  id: string;
  uiStatus: string;
  uiLabel: string;
  badgeClass: string;
  attemptNumber: number | null;
  attemptCount: number;
  errorMessage: string | null;
  createdAt: string | null;
  finishedAt: string | null;
};

type CpJobHistoryCardProps = {
  accessToken: string | undefined;
};

function shortId(id: string): string {
  const s = String(id ?? '');
  if (s.length <= 12) return s;
  return `${s.slice(0, 8)}…`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN');
  } catch {
    return '—';
  }
}

/**
 * B2.4 — Product history from Control Plane Job/Attempt (not Comfy /history).
 */
export default function CpJobHistoryCard({ accessToken }: CpJobHistoryCardProps) {
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [jobs, setJobs] = useState<HistoryJob[]>([]);

  const load = useCallback(async () => {
    if (!accessToken) {
      setJobs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/jobs?limit=30', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      setAvailable(data.available !== false);
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-header">
        <span className="card-title">📜 LỊCH SỬ JOB (CONTROL PLANE)</span>
        <button
          type="button"
          onClick={() => void load()}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--accent-blue)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Làm mới
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
        Lịch sử sản phẩm lấy từ Job/Attempt trên Control Plane — không phụ thuộc{' '}
        <code>/history</code> Comfy trên máy đã hủy.
      </p>

      {loading ? (
        <p className="dashboard-stat-empty">Đang tải...</p>
      ) : !available ? (
        <p className="dashboard-stat-empty">
          Bảng Job CP chưa sẵn sàng. Sau migration, run cũ vẫn xem được sau khi đổi máy.
        </p>
      ) : jobs.length === 0 ? (
        <p className="dashboard-stat-empty">Chưa có Job trên Control Plane.</p>
      ) : (
        <div className="dashboard-stat-list">
          {jobs.map((job) => (
            <div key={job.id} className="dashboard-stat-row" style={{ alignItems: 'flex-start' }}>
              <div>
                <span className="dashboard-stat-name">Job {shortId(job.id)}</span>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {job.attemptCount > 0
                    ? `${job.attemptCount} attempt` +
                      (job.attemptNumber != null ? ` · #${job.attemptNumber}` : '')
                    : 'Chưa có attempt'}
                  {' · '}
                  {formatWhen(job.finishedAt ?? job.createdAt)}
                  {job.errorMessage ? (
                    <>
                      <br />
                      <span style={{ color: '#f87171' }}>{job.errorMessage}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <span
                className={`job-badge ${job.badgeClass}`}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '4px 8px',
                  borderRadius: 6,
                  background:
                    job.uiStatus === 'succeeded'
                      ? 'rgba(74, 222, 128, 0.15)'
                      : job.uiStatus === 'failed'
                        ? 'rgba(248, 113, 113, 0.18)'
                        : job.uiStatus === 'retry'
                          ? 'rgba(251, 191, 36, 0.18)'
                          : 'rgba(56, 189, 248, 0.18)',
                  color:
                    job.uiStatus === 'succeeded'
                      ? '#4ade80'
                      : job.uiStatus === 'failed'
                        ? '#f87171'
                        : job.uiStatus === 'retry'
                          ? '#fbbf24'
                          : '#7dd3fc',
                }}
              >
                {job.uiLabel}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
