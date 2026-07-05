import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { routes } from '@/lib/routes';

type WorkflowRow = {
  id: string;
  name: string;
  recommended_gpu: string | null;
  is_public: boolean;
  created_at: string;
};

export default function DashboardRecentWorkflowsCard() {
  const [loading, setLoading] = useState(true);
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        setWorkflows([]);
        return;
      }

      const { data, error } = await supabase
        .from('workflows')
        .select('id, name, recommended_gpu, is_public, created_at')
        .or(`is_public.eq.true,user_id.eq.${session.user.id}`)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setWorkflows((data ?? []) as WorkflowRow[]);
    } catch {
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const system = workflows.filter((w) => w.is_public).length;
    const mine = workflows.filter((w) => !w.is_public).length;
    return { total: workflows.length, system, mine };
  }, [workflows]);

  const recent = workflows.slice(0, 4);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">📁 WORKFLOW GẦN ĐÂY</span>
        <Link
          href={routes.dashboardWorkflows}
          style={{ fontSize: 12, color: 'var(--accent-blue)', textDecoration: 'none' }}
        >
          Xem tất cả →
        </Link>
      </div>

      {loading ? (
        <p className="dashboard-stat-empty">Đang tải...</p>
      ) : stats.total === 0 ? (
        <p className="dashboard-stat-empty">Chưa có workflow. Khám phá thư viện hệ thống hoặc tải lên workflow của bạn.</p>
      ) : (
        <>
          <div className="dashboard-stat-summary">
            <span className="dashboard-stat-pill">{stats.total} workflow</span>
            <span className="dashboard-stat-pill muted">{stats.system} hệ thống</span>
            <span className="dashboard-stat-pill muted">{stats.mine} của tôi</span>
          </div>
          <div className="dashboard-stat-list">
            {recent.map((workflow) => (
              <div key={workflow.id} className="dashboard-stat-row">
                <span className="dashboard-stat-name" title={workflow.name}>
                  {workflow.is_public ? '🌐' : '👤'} {workflow.name}
                </span>
                <span className="dashboard-stat-meta">
                  {workflow.recommended_gpu ?? 'GPU'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
