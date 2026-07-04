import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useIsMobile } from '@/hooks/useIsMobile';

export type WorkflowRecord = {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  file_url: string | null;
  running_time_minutes: number;
  recommended_gpu: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

type FilterMode = 'all' | 'system' | 'mine';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatRunningTime(minutes: number) {
  const rounded = Math.round(Number(minutes));
  if (rounded <= 0) return '—';
  return `~${rounded} phút`;
}

function safeFilename(name: string) {
  return name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'workflow';
}

async function downloadWorkflowJson(workflow: WorkflowRecord) {
  const filename = `${safeFilename(workflow.name)}.json`;

  if (!workflow.file_url) {
    alert('Workflow chưa có file JSON.');
    return;
  }

  if (/^https?:\/\//i.test(workflow.file_url)) {
    window.open(workflow.file_url, '_blank', 'noopener,noreferrer');
    return;
  }

  try {
    const blob = new Blob([workflow.file_url], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch {
    alert('Không tải được file workflow.');
  }
}

type WorkflowCardProps = {
  workflow: WorkflowRecord;
  onDelete: (id: string) => void;
  deletingId: string | null;
  hideMobileActions?: boolean;
};

function WorkflowCard({ workflow, onDelete, deletingId, hideMobileActions = false }: WorkflowCardProps) {
  const isMine = !workflow.is_public;
  const busy = deletingId === workflow.id;

  const handleRun = () => {
    alert(`Đang chuẩn bị chạy "${workflow.name}" trên ComfyUI. (Tích hợp GPU sắp ra mắt)`);
  };

  const handleEdit = () => {
    alert(`Chỉnh sửa workflow "${workflow.name}" sẽ có trong bản cập nhật tiếp theo.`);
  };

  const handleDownload = () => {
    void downloadWorkflowJson(workflow);
  };

  const handleDelete = () => {
    if (!confirm(`Xóa workflow "${workflow.name}"?`)) return;
    onDelete(workflow.id);
  };

  return (
    <article className="workflow-card">
      {isMine && (
        <button
          type="button"
          className="workflow-delete-btn"
          onClick={handleDelete}
          disabled={busy}
          aria-label={`Xóa ${workflow.name}`}
          title="Xóa workflow"
        >
          {busy ? '...' : '✕'}
        </button>
      )}

      <div className="workflow-card-thumb">
        {workflow.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={workflow.thumbnail_url} alt="" loading="lazy" aria-hidden />
        ) : (
          <div className="workflow-thumb-fallback" aria-hidden />
        )}
      </div>

      <div className="workflow-card-body">
        <h3 className="workflow-card-title">{workflow.name}</h3>

        <div className="workflow-card-meta">
          <span>{formatDate(workflow.created_at)}</span>
          <span className="workflow-meta-dot">·</span>
          <span>{formatRunningTime(workflow.running_time_minutes)}</span>
        </div>

        <div className="workflow-badge-row">
          {workflow.recommended_gpu && (
            <span className="workflow-badge gpu">{workflow.recommended_gpu}</span>
          )}
          <span className={`workflow-badge ${isMine ? 'mine' : 'system'}`}>
            {isMine ? 'Của tôi' : 'Hệ thống'}
          </span>
        </div>

        <div className="workflow-card-actions">
          {!hideMobileActions && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={handleEdit}>
              Sửa
            </button>
          )}
          <button type="button" className="btn btn-sm btn-secondary" onClick={handleDownload}>
            Tải xuống
          </button>
        </div>

        <button type="button" className="workflow-run-btn" onClick={handleRun}>
          ▶ Chạy
        </button>
      </div>
    </article>
  );
}

export default function WorkflowPanel() {
  const { isMobile } = useIsMobile();
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        setError('Vui lòng đăng nhập để xem workflow.');
        setWorkflows([]);
        return;
      }

      const { data, error: queryError } = await supabase
        .from('workflows')
        .select('*')
        .or(`is_public.eq.true,user_id.eq.${session.user.id}`)
        .order('is_public', { ascending: false })
        .order('created_at', { ascending: false });

      if (queryError) throw queryError;
      setWorkflows((data ?? []) as WorkflowRecord[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không tải được danh sách workflow.';
      setError(message);
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const filtered = useMemo(() => {
    if (filter === 'system') return workflows.filter((w) => w.is_public);
    if (filter === 'mine') return workflows.filter((w) => !w.is_public);
    return workflows;
  }, [workflows, filter]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const supabase = getSupabaseBrowser();
      const { error: deleteError } = await supabase.from('workflows').delete().eq('id', id);
      if (deleteError) throw deleteError;
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Xóa workflow thất bại.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateNew = () => {
    alert('Tải lên workflow JSON mới sẽ có trong bản cập nhật tiếp theo.');
  };

  return (
    <div className="workflows-panel">
      <div className="workflows-page-header">
        <h2 className="workflows-page-title">📁 Workflow</h2>
        <div className="workflows-page-header-spacer" />
        {!isMobile && (
          <button type="button" className="btn btn-sm btn-primary" onClick={handleCreateNew}>
            ➕ Tạo Workflow mới
          </button>
        )}
      </div>

      <div className="workflows-filter-row">
        {(['all', 'system', 'mine'] as FilterMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`workflows-filter-btn${filter === mode ? ' active' : ''}`}
            onClick={() => setFilter(mode)}
          >
            {mode === 'all' ? 'Tất cả' : mode === 'system' ? 'Hệ thống' : 'Của tôi'}
          </button>
        ))}
      </div>

      {loading && (
        <div className="card">
          <p style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
            Đang tải workflow...
          </p>
        </div>
      )}

      {!loading && error && (
        <div className="card">
          <p style={{ padding: 24, color: '#f87171' }}>{error}</p>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            style={{ margin: '0 24px 24px' }}
            onClick={loadWorkflows}
          >
            Thử lại
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="card">
          <p style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center', fontSize: 14 }}>
            {filter === 'mine'
              ? 'Bạn chưa có workflow nào. Bấm "Tạo Workflow mới" để upload.'
              : 'Không có workflow nào trong danh mục này.'}
          </p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="workflow-grid">
          {filtered.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              onDelete={handleDelete}
              deletingId={deletingId}
              hideMobileActions={isMobile}
            />
          ))}
        </div>
      )}
    </div>
  );
}
