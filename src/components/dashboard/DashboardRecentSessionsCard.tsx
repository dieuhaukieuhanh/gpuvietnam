import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { USER_PLANS_CHANGED_EVENT } from '@/hooks/useUserPlans';
import { formatSessionDate } from '@/lib/gpu-sessions';
import { mapSessionsApiList } from '@/lib/scb-session-history-view-model';
import { routes } from '@/lib/routes';

type SessionsApiResponse = {
  sessions?: Array<Record<string, unknown>>;
  error?: string;
};

function formatUsageHours(seconds: number): string {
  const total = Math.max(0, seconds);
  const hours = total / 3600;
  if (hours >= 1) return `${hours.toFixed(1)} giờ`;
  const minutes = Math.floor(total / 60);
  if (minutes > 0) return `${minutes} phút`;
  return `${total} giây`;
}

type DashboardRecentSessionsCardProps = {
  accessToken: string | undefined;
};

export default function DashboardRecentSessionsCard({ accessToken }: DashboardRecentSessionsCardProps) {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<ReturnType<typeof mapSessionsApiList>>([]);

  const load = useCallback(async () => {
    if (!accessToken) {
      setSessions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/user/sessions?limit=30&offset=0', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as SessionsApiResponse;
      if (!res.ok) throw new Error(data.error ?? 'Không tải được phiên.');

      setSessions(mapSessionsApiList(data.sessions ?? []));
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!accessToken) return undefined;
    const onPlansChanged = () => {
      void load();
    };
    window.addEventListener(USER_PLANS_CHANGED_EVENT, onPlansChanged);
    return () => window.removeEventListener(USER_PLANS_CHANGED_EVENT, onPlansChanged);
  }, [accessToken, load]);

  const byDate = useMemo(() => {
    const map = new Map<string, { seconds: number; count: number }>();

    for (const session of sessions) {
      if (!session?.startedAt) continue;
      const dateKey = formatSessionDate(session.startedAt);
      const prev = map.get(dateKey) ?? { seconds: 0, count: 0 };
      const duration =
        session.billableSeconds != null
          ? session.billableSeconds
          : Number(session.durationSeconds ?? 0);
      map.set(dateKey, {
        seconds: prev.seconds + duration,
        count: prev.count + 1,
      });
    }

    return Array.from(map.entries())
      .map(([date, value]) => ({ date, ...value }))
      .slice(0, 6);
  }, [sessions]);

  const totalSeconds = useMemo(
    () => byDate.reduce((sum, row) => sum + row.seconds, 0),
    [byDate],
  );

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">📜 PHIÊN GẦN ĐÂY</span>
        <Link
          href={routes.dashboardLichSu}
          style={{ fontSize: 12, color: 'var(--accent-blue)', textDecoration: 'none' }}
        >
          Lịch sử →
        </Link>
      </div>

      {loading ? (
        <p className="dashboard-stat-empty">Đang tải...</p>
      ) : byDate.length === 0 ? (
        <p className="dashboard-stat-empty">
          Chưa có phiên làm việc. Bật máy GPU để bắt đầu ghi nhận thời gian sử dụng.
        </p>
      ) : (
        <>
          <div className="dashboard-stat-summary">
            <span className="dashboard-stat-pill">{formatUsageHours(totalSeconds)} tổng gần đây</span>
            <span className="dashboard-stat-pill muted">{sessions.length} phiên</span>
          </div>
          <div className="dashboard-stat-list">
            {byDate.map((row) => (
              <div key={row.date} className="dashboard-stat-row">
                <span className="dashboard-stat-name">📅 {row.date}</span>
                <span className="dashboard-stat-meta highlight">
                  {formatUsageHours(row.seconds)}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                    {' '}
                    · {row.count} phiên
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
