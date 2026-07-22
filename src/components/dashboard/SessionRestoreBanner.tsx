import { useCallback, useEffect, useState } from 'react';

type RestorePayload = {
  schema?: string;
  restoreKind?: string;
  projectContinues?: boolean;
  jobResumed?: boolean;
  jobRerunning?: boolean;
  project?: { id: string; name?: string | null } | null;
  workflow?: { id: string; name?: string | null; revision?: number } | null;
  snapshot?: { id: string; label?: string; createdAt?: string | null } | null;
  job?: {
    id: string;
    status?: string | null;
    uiStatus?: string | null;
    attemptNumber?: number | null;
  } | null;
  message?: string;
  available?: boolean;
};

type SessionRestoreBannerProps = {
  accessToken: string | undefined;
};

/**
 * B2.2 Session Restore demo banner — Project/Workflow survive GPU change.
 * Explicitly does NOT claim CUDA/job mid-run resume.
 */
export default function SessionRestoreBanner({ accessToken }: SessionRestoreBannerProps) {
  const [restore, setRestore] = useState<RestorePayload | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) {
      setRestore(null);
      return;
    }
    try {
      const res = await fetch('/api/cp/session-restore', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as { restore?: RestorePayload };
      setRestore(data.restore ?? null);
    } catch {
      setRestore(null);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaveSnapshot = async () => {
    if (!accessToken || !restore?.project?.id || !restore?.workflow?.id) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/cp/snapshots', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'save',
          projectId: restore.project.id,
          workflowId: restore.workflow.id,
          label: 'Save từ dashboard',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save thất bại');
      setSaveMsg('Đã lưu snapshot trên Control Plane.');
      void load();
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'Save thất bại');
    } finally {
      setSaving(false);
    }
  };

  if (dismissed || !restore) return null;

  const show =
    restore.projectContinues ||
    restore.jobRerunning ||
    restore.available === false;

  if (!show && !restore.message) return null;

  return (
    <div
      className="alert-card"
      style={{
        display: 'flex',
        marginBottom: 20,
        borderColor: restore.jobRerunning ? 'var(--accent-yellow, #fbbf24)' : 'var(--accent-blue)',
      }}
    >
      <span className="alert-icon">{restore.jobRerunning ? '🔄' : '💾'}</span>
      <div className="alert-content" style={{ flex: 1 }}>
        <div className="alert-title">
          {restore.jobRerunning ? 'Session Restore — Job đang chạy lại' : 'Session Restore'}
        </div>
        <div className="alert-desc">{restore.message}</div>
        {(restore.project || restore.workflow) && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            {restore.project?.name ? `Project: ${restore.project.name}` : null}
            {restore.project && restore.workflow ? ' · ' : null}
            {restore.workflow?.name
              ? `Workflow: ${restore.workflow.name} (rev ${restore.workflow.revision ?? 1})`
              : null}
            {restore.jobRerunning && restore.job?.attemptNumber
              ? ` · Attempt #${restore.job.attemptNumber}`
              : null}
            <div style={{ marginTop: 4 }}>
              Không resume CUDA / queue máy cũ — mở lại Comfy trên máy mới sẽ nạp graph từ
              Control Plane (nếu đã đồng bộ).
            </div>
          </div>
        )}
        {restore.project?.id && restore.workflow?.id && restore.available !== false ? (
          <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: 12, padding: '6px 12px' }}
              disabled={saving}
              onClick={() => void onSaveSnapshot()}
            >
              {saving ? 'Đang lưu…' : 'Save snapshot'}
            </button>
            {saveMsg ? <span style={{ fontSize: 12 }}>{saveMsg}</span> : null}
          </div>
        ) : null}
      </div>
      <button type="button" className="alert-close" onClick={() => setDismissed(true)}>
        ✕
      </button>
    </div>
  );
}
