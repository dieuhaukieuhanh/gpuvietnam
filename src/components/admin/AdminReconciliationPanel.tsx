import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-session';

type ReconciliationRun = {
  id: string;
  started_at: string;
  completed_at: string | null;
  repair: boolean;
  drift_count: number;
  repaired_count: number;
  skipped_count: number;
  failed_count: number;
  already_consistent_count: number;
};

type DriftItem = {
  id: string;
  drift_type: string;
  entity_type: string;
  entity_id: string;
  status: string;
  message: string | null;
  detected_at: string;
  instance_id: string | null;
};

type ReconcileApiResponse = {
  runs?: ReconciliationRun[];
  drifts?: DriftItem[];
  summary?: {
    openDriftCount: number;
    lastRun: ReconciliationRun | null;
  };
  error?: string;
};

function formatTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN');
}

export default function AdminReconciliationPanel() {
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [drifts, setDrifts] = useState<DriftItem[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [lastAction, setLastAction] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch('/api/admin/infrastructure/reconcile');
      const data = (await res.json()) as ReconcileApiResponse;
      if (!res.ok) throw new Error(data.error ?? 'Không tải được reconciliation.');

      setRuns(data.runs ?? []);
      setDrifts(data.drifts ?? []);
      setOpenCount(data.summary?.openDriftCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi tải reconciliation.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (preview: boolean, repair: boolean) => {
    setRunning(true);
    setError('');
    try {
      const res = await adminFetch('/api/admin/infrastructure/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview, repair }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Reconciliation thất bại.');

      setLastAction(
        preview
          ? `Scan: ${data.driftCount ?? 0} drift`
          : `Repair: ${data.counts?.repaired ?? 0} repaired, ${data.counts?.failed ?? 0} failed`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconciliation thất bại.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-header-row">
        <span className="stat-label" style={{ marginBottom: 0 }}>
          🔧 Infrastructure Reconciliation (SCB)
        </span>
        <span className="infra-filter-count">Drift mở: {openCount}</span>
      </div>

      <p className="stat-sub" style={{ marginTop: 0 }}>
        Scan/preview/repair qua API — không tính billing trên admin UI. Repair gọi domain M3/M6/M7 đã
        triển khai.
      </p>

      <div className="infra-refresh-actions" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={running}
          onClick={() => void runAction(true, false)}
        >
          🔍 Scan (preview)
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={running}
          onClick={() => {
            if (window.confirm('Chạy repair reconciliation? Chỉ sửa drift đã định nghĩa trong M13.')) {
              void runAction(false, true);
            }
          }}
        >
          🛠️ Run repair
        </button>
        <button type="button" className="btn btn-sm" disabled={loading} onClick={() => void load()}>
          🔄 Làm mới
        </button>
        {lastAction && <span className="infra-last-updated">{lastAction}</span>}
      </div>

      {loading ? (
        <p className="text-muted">Đang tải...</p>
      ) : error ? (
        <p className="text-red">{error}</p>
      ) : (
        <>
          <div className="stat-label">Lịch sử chạy gần đây</div>
          <div className="table-wrap" style={{ marginBottom: 16 }}>
            <table className="infra-table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Repair</th>
                  <th>Drift</th>
                  <th>Repaired</th>
                  <th>Skipped</th>
                  <th>Failed</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={6}>Chưa có lần chạy nào (hoặc bảng audit chưa apply).</td>
                  </tr>
                ) : (
                  runs.map((run) => (
                    <tr key={run.id}>
                      <td>{formatTime(run.started_at)}</td>
                      <td>{run.repair ? 'Có' : 'Scan'}</td>
                      <td>{run.drift_count}</td>
                      <td>{run.repaired_count}</td>
                      <td>{run.skipped_count}</td>
                      <td>{run.failed_count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="stat-label">Drift items</div>
          <div className="table-wrap">
            <table className="infra-table">
              <thead>
                <tr>
                  <th>Loại</th>
                  <th>Entity</th>
                  <th>Instance</th>
                  <th>Status</th>
                  <th>Phát hiện</th>
                </tr>
              </thead>
              <tbody>
                {drifts.length === 0 ? (
                  <tr>
                    <td colSpan={5}>Không có drift item.</td>
                  </tr>
                ) : (
                  drifts.map((drift) => (
                    <tr key={drift.id}>
                      <td className="mono">{drift.drift_type}</td>
                      <td>
                        {drift.entity_type}:{drift.entity_id}
                      </td>
                      <td className="mono">{drift.instance_id ?? '—'}</td>
                      <td>{drift.status}</td>
                      <td>{formatTime(drift.detected_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
