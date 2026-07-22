import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { routes } from '@/lib/routes';

type WorkflowListItem = {
  id: string;
  name: string;
  revision?: number;
  updatedAt?: string;
};

type CpWorkspaceDuringBootCardProps = {
  accessToken: string | undefined;
  /** opening | waiting_comfy — GPU boot or Comfy not ready yet */
  mode: 'opening' | 'waiting_comfy';
};

/**
 * DEV/internal scaffold only — NOT mounted on the customer dashboard.
 * Product path: Comfy editor sync (`gpuvietnam_cp_sync`) + SessionRestoreBanner.
 * Do not re-wire this card into DashboardPage without an explicit product decision.
 */
export default function CpWorkspaceDuringBootCard({
  accessToken,
  mode,
}: CpWorkspaceDuringBootCardProps) {
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('Draft khi chờ GPU');
  const [documentText, setDocumentText] = useState('{\n  "nodes": {}\n}');
  const [revision, setRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const loadList = useCallback(async () => {
    if (!accessToken) {
      setWorkflows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/cp/workflows?limit=10', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (res.status === 503 || data.available === false) {
        setUnavailable(true);
        setWorkflows([]);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Không tải được workflow CP');
      setUnavailable(false);
      const list = Array.isArray(data.workflows) ? data.workflows : [];
      setWorkflows(list);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Lỗi tải workflow');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  const loadOne = useCallback(
    async (id: string) => {
      if (!accessToken || !id) return;
      try {
        const res = await fetch(`/api/cp/workflows?id=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Không tải được document');
        const wf = data.workflow;
        setName(String(wf?.name ?? 'Untitled'));
        setRevision(Number(wf?.revision ?? 1));
        setDocumentText(JSON.stringify(wf?.document ?? { nodes: {} }, null, 2));
        setSelectedId(id);
      } catch (err) {
        setMsg(err instanceof Error ? err.message : 'Lỗi tải document');
      }
    },
    [accessToken],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadOne(selectedId);
  }, [selectedId, loadOne]);

  const onCreate = async () => {
    if (!accessToken) return;
    setSaving(true);
    setMsg(null);
    try {
      let document: Record<string, unknown> = { nodes: {} };
      try {
        document = JSON.parse(documentText);
      } catch {
        /* use empty */
      }
      const res = await fetch('/api/cp/workflows', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: name || 'Draft khi chờ GPU', document }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tạo thất bại');
      setMsg('Đã tạo workflow trên Control Plane (không cần GPU).');
      setSelectedId(data.workflow?.id ?? null);
      setRevision(Number(data.workflow?.revision ?? 1));
      await loadList();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Tạo thất bại');
    } finally {
      setSaving(false);
    }
  };

  const onSave = async () => {
    if (!accessToken || !selectedId) return;
    setSaving(true);
    setMsg(null);
    try {
      const document = JSON.parse(documentText);
      const res = await fetch('/api/cp/workflows', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workflowId: selectedId, name, document }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lưu thất bại');
      setRevision(Number(data.workflow?.revision ?? revision));
      setMsg('Đã lưu trên Control Plane. GPU boot xong sẽ submit được từ document này.');
      await loadList();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Lưu thất bại — kiểm tra JSON');
    } finally {
      setSaving(false);
    }
  };

  const onSaveSnapshot = async () => {
    if (!accessToken || !selectedId) return;
    setSaving(true);
    setMsg(null);
    try {
      const restoreRes = await fetch('/api/cp/session-restore', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const restoreData = await restoreRes.json();
      const projectId = restoreData.restore?.project?.id ?? null;
      const res = await fetch('/api/cp/snapshots', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'save',
          projectId,
          workflowId: selectedId,
          label: mode === 'opening' ? 'Snapshot lúc GPU boot' : 'Snapshot chờ Comfy',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Snapshot thất bại');
      setMsg('Đã lưu snapshot trên Control Plane.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Snapshot thất bại');
    } finally {
      setSaving(false);
    }
  };

  const title =
    mode === 'opening'
      ? 'CONTROL PLANE — Soạn bài trong lúc GPU khởi động'
      : 'CONTROL PLANE — Soạn bài (Comfy chưa sẵn sàng)';

  return (
    <div className="card" id="cp-workspace-panel" style={{ marginTop: 16 }}>
      <div className="card-header">
        <span className="card-title">{title}</span>
      </div>
      <p style={{ fontSize: 13, margin: '0 0 12px', lineHeight: 1.5 }}>
        Session / Project / Workflow nằm trên Control Plane — <strong>không cần chờ GPU</strong> để
        soạn hoặc lưu. Nút <em>Vào phòng làm việc</em> / Generate chỉ mở khi Runtime Comfy sẵn sàng.
      </p>

      {unavailable ? (
        <p className="dashboard-stat-empty">
          CP workflows chưa sẵn sàng (cần migration 0046). GPU vẫn đang boot bình thường.
        </p>
      ) : loading ? (
        <p className="dashboard-stat-empty">Đang tải workflow CP...</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <select
              className="dashboard-workspace-select"
              style={{ minWidth: 200, flex: 1 }}
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value || null)}
              aria-label="Chọn workflow CP"
            >
              <option value="">— Workflow CP —</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} (rev {w.revision ?? 1})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => void onCreate()}
            >
              Tạo draft mới
            </button>
          </div>

          <label className="gpu-edit-label" style={{ display: 'block', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tên</span>
            <input
              className="gpu-edit-field"
              style={{ width: '100%', marginTop: 4 }}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="gpu-edit-label" style={{ display: 'block', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Document JSON (SoT trên CP)
              {revision != null ? ` · rev ${revision}` : ''}
            </span>
            <textarea
              className="gpu-edit-field mono"
              rows={8}
              style={{ width: '100%', marginTop: 4, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
              value={documentText}
              onChange={(e) => setDocumentText(e.target.value)}
            />
          </label>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-success"
              disabled={saving || !selectedId}
              onClick={() => void onSave()}
            >
              {saving ? 'Đang lưu...' : 'Lưu trên Control Plane'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving || !selectedId}
              onClick={() => void onSaveSnapshot()}
            >
              Lưu snapshot
            </button>
            <Link href={routes.dashboardLichSu} className="btn btn-secondary">
              Xem lịch sử Job
            </Link>
          </div>

          {msg ? (
            <p style={{ fontSize: 12, marginTop: 10, color: 'var(--accent-blue)' }}>{msg}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
