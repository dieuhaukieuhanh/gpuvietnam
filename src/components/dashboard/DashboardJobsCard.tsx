import { useCallback, useEffect, useState } from 'react';

type JobRow = {
  id: string;
  uiStatus: string;
  uiLabel: string;
  badgeClass: string;
  attemptNumber: number | null;
  attemptCount: number;
  attemptStatus: string | null;
  errorMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type JobsApiResponse = {
  available?: boolean;
  jobs?: JobRow[];
  error?: string | null;
};

function shortId(id: string): string {
  const s = String(id ?? '');
  if (s.length <= 10) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

type DashboardJobsCardProps = {
  accessToken: string | undefined;
};

/**
 * Minimal Job / Attempt status card (Architecture v2.0 B1.8).
 * Shows queued / running / failed / retry for Control Plane Jobs.
 */
export default function DashboardJobsCard({ accessToken }: DashboardJobsCardProps) {
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) {
      setJobs([]);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/dashboard/jobs?limit=12', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as JobsApiResponse;
      if (!res.ok) throw new Error(data.error ?? 'Không tải được Job.');

      setAvailable(data.available !== false);
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setError(data.error ?? null);
    } catch (err) {
      setJobs([]);
      setError(err instanceof Error ? err.message : 'Lỗi tải Job.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!accessToken) return undefined;
    const hasActive = jobs.some((j) =>
      ['queued', 'running', 'retry'].includes(j.uiStatus),
    );
    if (!hasActive) return undefined;
    const id = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(id);
  }, [accessToken, jobs, load]);

  return (
    <div className="card dashboard-jobs-card">
      <div className="card-header">
        <span className="card-title">⚙️ JOB / ATTEMPT</span>
        <button
          type="button"
          className="dashboard-jobs-refresh"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          disabled={!accessToken || loading}
        >
          Làm mới
        </button>
      </div>

      <style jsx>{`
        .dashboard-jobs-refresh {
          border: none;
          background: transparent;
          color: var(--accent-blue);
          font-size: 12px;
          cursor: pointer;
          padding: 0;
        }
        .dashboard-jobs-refresh:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .job-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .job-row:last-child {
          border-bottom: none;
        }
        .job-meta {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 4px;
          line-height: 1.4;
        }
        .job-badge {
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 600;
          padding: 4px 8px;
          border-radius: 6px;
          letter-spacing: 0.02em;
        }
        .job-badge-queued {
          background: rgba(120, 140, 180, 0.2);
          color: #a8b4d0;
        }
        .job-badge-running {
          background: rgba(56, 189, 248, 0.18);
          color: #7dd3fc;
        }
        .job-badge-retry {
          background: rgba(251, 191, 36, 0.18);
          color: #fbbf24;
        }
        .job-badge-succeeded {
          background: rgba(74, 222, 128, 0.15);
          color: #4ade80;
        }
        .job-badge-failed {
          background: rgba(248, 113, 113, 0.18);
          color: #f87171;
        }
        .job-badge-cancelled {
          background: rgba(148, 163, 184, 0.15);
          color: #94a3b8;
        }
      `}</style>

      {loading ? (
        <p className="dashboard-stat-empty">Đang tải...</p>
      ) : !available ? (
        <p className="dashboard-stat-empty">
          Job Control Plane chưa sẵn sàng trên môi trường này (cần migration CP). Trạng thái phiên
          GPU vẫn xem ở thẻ máy phía trên.
        </p>
      ) : error && jobs.length === 0 ? (
        <p className="dashboard-stat-empty">{error}</p>
      ) : jobs.length === 0 ? (
        <p className="dashboard-stat-empty">
          Chưa có Job. Khi chạy render qua Control Plane, trạng thái queued / running / failed /
          chạy lại sẽ hiện tại đây.
        </p>
      ) : (
        <div className="dashboard-jobs-list">
          {jobs.map((job) => (
            <div key={job.id} className="job-row">
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Job {shortId(job.id)}</div>
                <div className="job-meta">
                  {job.attemptNumber != null
                    ? `Attempt #${job.attemptNumber}`
                    : 'Chưa có Attempt'}
                  {job.attemptCount > 1 ? ` · ${job.attemptCount} lần thử` : ''}
                  {' · '}
                  {formatWhen(job.updatedAt ?? job.createdAt)}
                  {job.errorMessage ? (
                    <>
                      <br />
                      <span style={{ color: '#f87171' }}>{job.errorMessage}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <span className={`job-badge ${job.badgeClass}`}>{job.uiLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
