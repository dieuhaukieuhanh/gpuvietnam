import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useIsMobile } from '@/hooks/useIsMobile';

export type ModelRecord = {
  id: string;
  name: string;
  type: 'checkpoint' | 'lora';
  category: 'system' | 'user';
  user_id: string | null;
  file_url: string | null;
  thumbnail_url: string | null;
  size_mb: number;
  created_at: string;
};

type FilterMode = 'all' | 'system' | 'mine';

const ACCEPTED_EXTENSIONS = ['.safetensors', '.ckpt', '.pt', '.pth'];
const MAX_FILE_MB = 500;

function formatSizeMb(mb: number) {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)}GB`;
  return `${Math.round(mb)}MB`;
}

function typeLabel(type: ModelRecord['type']) {
  return type === 'checkpoint' ? 'Checkpoint' : 'LoRA';
}

function typeIcon(type: ModelRecord['type']) {
  return type === 'checkpoint' ? '🧠' : '🎨';
}

function guessTypeFromFilename(name: string): ModelRecord['type'] {
  const lower = name.toLowerCase();
  if (lower.includes('lora')) return 'lora';
  return 'checkpoint';
}

function displayNameFromFile(name: string) {
  return name.replace(/\.(safetensors|ckpt|pt|pth)$/i, '').replace(/[-_]/g, ' ');
}

type ModelCardProps = {
  model: ModelRecord;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
};

function ModelCard({ model, selected, onToggleSelect, onDelete, deletingId }: ModelCardProps) {
  const isMine = model.category === 'user';
  const busy = deletingId === model.id;

  const handleUse = () => {
    alert(`Đang chuẩn bị dùng "${model.name}" trên ComfyUI. (Tích hợp GPU sắp ra mắt)`);
  };

  const handleDownload = () => {
    if (!model.file_url) {
      alert('Model hệ thống — file sẽ được mount sẵn trên máy GPU.');
      return;
    }
    window.open(model.file_url, '_blank', 'noopener,noreferrer');
  };

  const handleDelete = () => {
    if (!confirm(`Xóa model "${model.name}"?`)) return;
    onDelete(model.id);
  };

  return (
    <div className={`model-card${selected ? ' selected' : ''}`}>
      <div className="model-card-visual">
        {isMine && (
          <label className="model-card-select" title="Chọn để xóa hàng loạt">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(model.id)}
              aria-label={`Chọn ${model.name}`}
            />
          </label>
        )}
        {model.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={model.thumbnail_url} alt="" loading="lazy" aria-hidden />
        ) : (
          <div className="model-visual-fallback" aria-hidden>
            <span className="model-icon">{typeIcon(model.type)}</span>
          </div>
        )}
        <div className="model-card-overlay">
          <div className="model-name">{model.name}</div>
          <div className="model-meta-line">
            <span className="model-type-tag">{typeLabel(model.type)}</span>
            <span className="model-size">{formatSizeMb(Number(model.size_mb))}</span>
          </div>
          <span className={`model-badge ${isMine ? 'mine' : 'system'}`}>
            {isMine ? 'Của tôi' : 'Hệ thống'}
          </span>
        </div>
      </div>
      <div className="model-actions">
        <button type="button" className="btn btn-sm btn-secondary" onClick={handleUse}>
          Dùng ngay
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={handleDownload}>
          Tải về
        </button>
        {isMine && (
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={handleDelete}
            disabled={busy}
            aria-label="Xóa model"
          >
            {busy ? '...' : '🗑️'}
          </button>
        )}
      </div>
    </div>
  );
}

type ModelSectionProps = {
  title: string;
  icon: string;
  models: ModelRecord[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
};

function ModelSection({
  title,
  icon,
  models,
  selectedIds,
  onToggleSelect,
  onDelete,
  deletingId,
}: ModelSectionProps) {
  const totalMb = models.reduce((sum, m) => sum + Number(m.size_mb), 0);

  if (models.length === 0) return null;

  return (
    <div className="card model-section-card">
      <div className="card-header">
        <span className="card-title">
          {icon} {title}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {models.length} model · {formatSizeMb(totalMb)}
        </span>
      </div>
      <div className="model-grid">
        {models.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            selected={selectedIds.has(model.id)}
            onToggleSelect={onToggleSelect}
            onDelete={onDelete}
            deletingId={deletingId}
          />
        ))}
      </div>
    </div>
  );
}

export default function ModelLoraPanel() {
  const { isMobile } = useIsMobile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadType, setUploadType] = useState<ModelRecord['type']>('lora');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        setError('Vui lòng đăng nhập để xem model.');
        setModels([]);
        return;
      }

      const { data, error: queryError } = await supabase
        .from('models')
        .select('*')
        .or(`category.eq.system,user_id.eq.${session.user.id}`)
        .order('type', { ascending: true })
        .order('category', { ascending: true })
        .order('name', { ascending: true });

      if (queryError) throw queryError;
      setModels((data ?? []) as ModelRecord[]);
      setSelectedIds(new Set());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không tải được danh sách model.';
      setError(message);
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const filtered = useMemo(() => {
    if (filter === 'system') return models.filter((m) => m.category === 'system');
    if (filter === 'mine') return models.filter((m) => m.category === 'user');
    return models;
  }, [models, filter]);

  const checkpoints = filtered.filter((m) => m.type === 'checkpoint');
  const loras = filtered.filter((m) => m.type === 'lora');

  const selectableMineIds = useMemo(
    () => new Set(models.filter((m) => m.category === 'user').map((m) => m.id)),
    [models],
  );

  const selectedMineCount = useMemo(
    () => Array.from(selectedIds).filter((id) => selectableMineIds.has(id)).length,
    [selectedIds, selectableMineIds],
  );

  const toggleSelect = (id: string) => {
    if (!selectableMineIds.has(id)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const supabase = getSupabaseBrowser();
      const { error: deleteError } = await supabase.from('models').delete().eq('id', id);
      if (deleteError) throw deleteError;
      setModels((prev) => prev.filter((m) => m.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Xóa model thất bại.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds).filter((id) => selectableMineIds.has(id));
    if (ids.length === 0) {
      alert('Chọn ít nhất một model "Của tôi" để xóa.');
      return;
    }

    const names = models
      .filter((m) => ids.includes(m.id))
      .map((m) => m.name)
      .slice(0, 5);
    const preview = names.join(', ') + (ids.length > 5 ? ` (+${ids.length - 5} model khác)` : '');

    if (!confirm(`Xóa ${ids.length} model đã chọn?\n\n${preview}`)) return;

    setBulkDeleting(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error: deleteError } = await supabase.from('models').delete().in('id', ids);
      if (deleteError) throw deleteError;
      setModels((prev) => prev.filter((m) => !ids.includes(m.id)));
      setSelectedIds(new Set());
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Xóa hàng loạt thất bại.');
    } finally {
      setBulkDeleting(false);
    }
  };

  const openUploadFlow = () => {
    setUploadError('');
    setUploadFile(null);
    setUploadName('');
    setUploadType('lora');
    fileInputRef.current?.click();
  };

  const handleFilePicked = (file: File | null) => {
    if (!file) return;

    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      alert(`Chỉ hỗ trợ file: ${ACCEPTED_EXTENSIONS.join(', ')}`);
      return;
    }

    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > MAX_FILE_MB) {
      alert(`File quá lớn (tối đa ${MAX_FILE_MB}MB).`);
      return;
    }

    setUploadFile(file);
    setUploadName(displayNameFromFile(file.name));
    setUploadType(guessTypeFromFilename(file.name));
    setUploadError('');
    setShowUploadModal(true);
  };

  const handleUploadSubmit = async () => {
    if (!uploadFile) return;
    if (!uploadName.trim()) {
      setUploadError('Vui lòng nhập tên model.');
      return;
    }

    setUploading(true);
    setUploadError('');

    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) throw new Error('Phiên đăng nhập hết hạn.');

      const safeName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${session.user.id}/${Date.now()}-${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from('user-models')
        .upload(storagePath, uploadFile, { upsert: false });

      if (uploadErr) {
        if (uploadErr.message.includes('Bucket not found')) {
          throw new Error('Chưa cấu hình storage. Chạy supabase/storage-models.sql trên Supabase.');
        }
        throw uploadErr;
      }

      const { data: publicUrl } = supabase.storage.from('user-models').getPublicUrl(storagePath);
      const sizeMb = Math.round((uploadFile.size / (1024 * 1024)) * 10) / 10;

      const { data: inserted, error: insertErr } = await supabase
        .from('models')
        .insert({
          name: uploadName.trim(),
          type: uploadType,
          category: 'user',
          user_id: session.user.id,
          file_url: publicUrl.publicUrl,
          size_mb: sizeMb,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      setModels((prev) => [...prev, inserted as ModelRecord].sort((a, b) => a.name.localeCompare(b.name)));
      setShowUploadModal(false);
      setUploadFile(null);
      setFilter('mine');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Tải lên thất bại.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="models-lora-panel">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => {
          handleFilePicked(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />

      <div className="models-page-header">
        <h2 className="models-page-title">🧩 Model &amp; LoRA</h2>
        <div className="models-page-header-spacer" />
        <div className="models-page-actions">
          {!isMobile && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={openUploadFlow}>
              ➕ Tải lên models
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={handleBulkDelete}
            disabled={bulkDeleting || selectedMineCount === 0}
          >
            {bulkDeleting ? 'Đang xóa...' : '🗑️ Xóa đã chọn'}
            {selectedMineCount > 0 ? ` (${selectedMineCount})` : ''}
          </button>
        </div>
      </div>

      <div className="models-filter-row">
        {(['all', 'system', 'mine'] as FilterMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`models-filter-btn${filter === mode ? ' active' : ''}`}
            onClick={() => setFilter(mode)}
          >
            {mode === 'all' ? 'Tất cả' : mode === 'system' ? 'Hệ thống' : 'Của tôi'}
          </button>
        ))}
      </div>

      {loading && (
        <div className="card">
          <p style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
            Đang tải model...
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
            onClick={loadModels}
          >
            Thử lại
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="card">
          <p style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center', fontSize: 14 }}>
            {filter === 'mine'
              ? 'Bạn chưa có model nào. Bấm "Tải lên models" để upload.'
              : 'Không có model nào trong danh mục này.'}
          </p>
        </div>
      )}

      {!loading && !error && (
        <>
          <ModelSection
            title="CHECKPOINT MODELS"
            icon="🧠"
            models={checkpoints}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onDelete={handleDelete}
            deletingId={deletingId}
          />
          <ModelSection
            title="LORA MODELS"
            icon="🎨"
            models={loras}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onDelete={handleDelete}
            deletingId={deletingId}
          />
        </>
      )}

      <div className={`modal-overlay${showUploadModal ? ' active' : ''}`}>
        <div className="modal" role="dialog" aria-labelledby="uploadModelTitle">
          <button
            type="button"
            className="close-btn"
            onClick={() => !uploading && setShowUploadModal(false)}
            aria-label="Đóng"
          >
            ✕
          </button>
          <h3 id="uploadModelTitle">➕ Tải lên model</h3>

          {uploadFile && (
            <p className="models-upload-hint">
              File: <strong>{uploadFile.name}</strong> ({formatSizeMb(uploadFile.size / (1024 * 1024))})
            </p>
          )}

          <div className="models-modal-field">
            <label htmlFor="uploadModelName">Tên hiển thị</label>
            <input
              id="uploadModelName"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              placeholder="VD: LoRA Anime Style"
              disabled={uploading}
            />
          </div>

          <div className="models-modal-field">
            <label htmlFor="uploadModelType">Loại model</label>
            <select
              id="uploadModelType"
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value as ModelRecord['type'])}
              disabled={uploading}
            >
              <option value="checkpoint">Checkpoint</option>
              <option value="lora">LoRA</option>
            </select>
          </div>

          <p className="models-upload-hint">
            Hỗ trợ {ACCEPTED_EXTENSIONS.join(', ')} · Tối đa {MAX_FILE_MB}MB · Lưu vào kho cá nhân của bạn.
          </p>

          {uploadError && <div className="error-msg">{uploadError}</div>}

          <div className="models-modal-actions">
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setShowUploadModal(false)}
              disabled={uploading}
            >
              Hủy
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleUploadSubmit}
              disabled={uploading || !uploadFile}
            >
              {uploading ? 'Đang tải lên...' : 'Xác nhận tải lên'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
