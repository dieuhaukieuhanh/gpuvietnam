import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-session';

type ProviderId = 'vast' | 'clore' | 'salad';

type ProviderRoutingPolicy = {
  providers: Record<ProviderId, boolean>;
  priority: ProviderId[];
  updatedAt?: string | null;
  updatedBy?: string | null;
  source?: string;
};

const LABELS: Record<ProviderId, string> = {
  vast: 'Vast.ai',
  clore: 'Clore',
  salad: 'Salad',
};

const ALL: ProviderId[] = ['vast', 'clore', 'salad'];

export default function AdminProviderRoutingPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saved, setSaved] = useState<ProviderRoutingPolicy>({
    providers: { vast: true, clore: false, salad: false },
    priority: ['vast', 'clore', 'salad'],
  });
  const [draft, setDraft] = useState<ProviderRoutingPolicy>(saved);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/provider-routing-policy');
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Không tải được chính sách provider.');
        return;
      }
      setSaved(data.policy);
      setDraft(data.policy);
    } catch {
      setError('Lỗi mạng khi tải chính sách provider.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const dirty =
    JSON.stringify(draft.providers) !== JSON.stringify(saved.providers) ||
    JSON.stringify(draft.priority) !== JSON.stringify(saved.priority);

  const move = (id: ProviderId, dir: -1 | 1) => {
    setDraft((prev) => {
      const list = [...prev.priority];
      const i = list.indexOf(id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= list.length) return prev;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...prev, priority: next };
    });
  };

  const toggle = (id: ProviderId) => {
    setDraft((prev) => ({
      ...prev,
      providers: { ...prev.providers, [id]: !prev.providers[id] },
    }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/provider-routing-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providers: draft.providers,
          priority: draft.priority,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data?.errors?.join('; ') || data?.error || 'Lưu thất bại.',
        );
        return;
      }
      setSaved(data.policy);
      setDraft(data.policy);
      setToast(data.note || 'Đã lưu chính sách provider.');
    } catch {
      setError('Lỗi mạng khi lưu.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="text-muted">Đang tải chính sách provider…</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="stat-label">Provider routing — Start máy</div>
      <p className="text-muted" style={{ fontSize: 13, marginTop: 6, marginBottom: 12 }}>
        Bật/tắt và xếp thứ tự ưu tiên khi <strong>thuê máy mới</strong> (Start).
        Khách đang chạy trên Vast/Clore/Salad <strong>không bị cắt</strong> khi bạn tắt provider.
        Áp dụng gần như ngay cho lần Start tiếp theo (cache ~5s).
        Hỗ trợ GPU: 3090 / 4090 / <strong>5090</strong> trên Vast và Clore.
      </p>

      {error && (
        <p style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</p>
      )}
      {toast && (
        <p style={{ color: '#4ade80', fontSize: 13, marginBottom: 8 }}>{toast}</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {draft.priority.map((id, index) => (
          <div
            key={id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <span className="text-muted" style={{ width: 28, fontWeight: 600 }}>
              {index + 1}.
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={draft.providers[id] === true}
                onChange={() => toggle(id)}
              />
              <span style={{ color: draft.providers[id] ? '#4ade80' : '#9ca3af' }}>
                {LABELS[id]}
              </span>
            </label>
            <button
              type="button"
              className="btn"
              disabled={index === 0}
              onClick={() => move(id, -1)}
              title="Ưu tiên cao hơn"
            >
              ↑
            </button>
            <button
              type="button"
              className="btn"
              disabled={index === draft.priority.length - 1}
              onClick={() => move(id, 1)}
              title="Ưu tiên thấp hơn"
            >
              ↓
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-success"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? 'Đang lưu…' : 'Lưu chính sách'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!dirty || saving}
          onClick={() => setDraft(saved)}
        >
          Huỷ
        </button>
        <button type="button" className="btn" onClick={() => void load()}>
          Tải lại
        </button>
      </div>

      {saved.updatedAt && (
        <p className="text-muted" style={{ fontSize: 11, marginTop: 10 }}>
          Cập nhật: {new Date(saved.updatedAt).toLocaleString('vi-VN')}
          {saved.updatedBy ? ` · ${saved.updatedBy}` : ''}
          {saved.source ? ` · nguồn ${saved.source}` : ''}
        </p>
      )}

      <p className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
        Env khẩn cấp (GPU_VAST_ONLY / GPU_CLORE_ONLY / GPU_SALAD_ONLY) vẫn ghi đè nếu được set trên
        server. Thứ tự đang bật:{' '}
        <strong>
          {draft.priority.filter((id) => draft.providers[id]).map((id) => LABELS[id]).join(' → ') ||
            '(không có)'}
        </strong>
        {ALL.every((id) => !draft.providers[id]) ? ' — cần bật ít nhất một provider' : ''}
      </p>
    </div>
  );
}
