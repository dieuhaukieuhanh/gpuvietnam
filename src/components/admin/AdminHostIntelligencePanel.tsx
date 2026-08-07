import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-session';

type HostIntelligenceConfig = {
  enabled: boolean;
  targetPerLine: Record<string, number>;
  providers: Record<string, boolean>;
};

type HostIntelligenceSummary = {
  totalHosts?: number;
  knownGood?: number;
  knownGoodByLine?: Record<string, number>;
  stale?: number;
  blacklisted?: number;
  inCooldown?: number;
  averagePassRate?: number;
  [key: string]: unknown;
};

type HostIntelligenceResponse = {
  config: HostIntelligenceConfig;
  summary: HostIntelligenceSummary;
  error?: string;
};

const GPU_LINES: { key: string; label: string }[] = [
  { key: 'rtx3090', label: 'RTX 3090 (Starter)' },
  { key: 'rtx4090_1x', label: 'RTX 4090 (Pro)' },
  { key: 'rtx5090_1x', label: 'RTX 5090 (Studio)' },
];

const PROVIDERS: { key: string; label: string }[] = [
  { key: 'vast', label: 'Vast.ai' },
  { key: 'clore', label: 'Clore' },
];

function plural(n: number, singular: string, pluralWord?: string) {
  return `${n} ${n === 1 ? singular : (pluralWord ?? singular + 's')}`;
}

/** Admin: bật/tắt Host Intelligence System + cấu hình target pool + provider toggles. */
export default function AdminHostIntelligencePanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [saved, setSaved] = useState<HostIntelligenceConfig>({
    enabled: true,
    targetPerLine: { rtx3090: 4, rtx4090_1x: 4, rtx5090_1x: 4 },
    providers: { vast: true, clore: false },
  });
  const [draft, setDraft] = useState<HostIntelligenceConfig>(saved);
  const [summary, setSummary] = useState<HostIntelligenceSummary>({});

  const applyConfig = useCallback((cfg: HostIntelligenceConfig, sum: HostIntelligenceSummary) => {
    setSaved(cfg);
    setDraft(cfg);
    setSummary(sum);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/host-intelligence-config');
      const data: HostIntelligenceResponse = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Không tải được cấu hình.');
        return;
      }
      applyConfig(data.config, data.summary);
    } catch {
      setError('Lỗi mạng khi tải cấu hình Host Intelligence.');
    } finally {
      setLoading(false);
    }
  }, [applyConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await adminFetch('/api/admin/host-intelligence-config', {
        method: 'PUT',
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? 'Lưu thất bại.');
        return;
      }
      applyConfig(data.config, data.summary);
      setToast('Đã lưu cấu hình Host Intelligence');
    } catch {
      alert('Lỗi mạng khi lưu.');
    } finally {
      setSaving(false);
    }
  };

  const handleUndo = () => {
    setDraft(saved);
    setToast('Đã hoàn tác về cấu hình đã lưu');
  };

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(saved);

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="text-muted">Đang tải cấu hình Host Intelligence...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="text-red">{error}</p>
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => void load()}>
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="stat-label">Quét & Đánh giá GPU Hosts</div>
      <div className="stat-sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
        Hệ thống tự động thuê thử GPU từ Vast/Clore mỗi <strong>25 phút</strong> bằng image test siêu nhẹ (~300MB, không ComfyUI).
        Host nào vượt qua kiểm tra (boot nhanh, GPU đúng, mạng ổn) được đưa vào <strong>pool Known-Good</strong>.
        Khi KH thuê GPU, hệ thống ưu tiên chọn host trong pool này — giảm tỉ lệ thuê trúng máy lỗi.
        Chi phí test ~$2-3/tháng.
      </div>

      {/* ── Estimate cards ─────────────────────────────────────────────── */}
      {summary.totalHosts != null && (
        <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {/* Pass rate → attempts per ready */}
          <div className="stat-card" style={{ padding: '10px 16px', background: '#1a1a24', borderRadius: 8, flex: '1 1 200px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Tỉ lệ thuê trúng máy tốt</span>
            <div className="stat-value" style={{ fontSize: 22, fontWeight: 700, color: summary.averagePassRate != null && summary.averagePassRate >= 0.6 ? '#4ade80' : '#fbbf24' }}>
              {summary.averagePassRate != null ? `${Math.round((summary.averagePassRate as number) * 100)}%` : '—'}
            </div>
            <span className="text-muted" style={{ fontSize: 11 }}>
              {summary.averagePassRate != null
                ? `~${Math.round(1 / (summary.averagePassRate as number) * 10) / 10} lần thuê → 1 máy sẵn sàng`
                : 'Chưa đủ dữ liệu'}
            </span>
          </div>
          {/* Total verified */}
          <div className="stat-card" style={{ padding: '10px 16px', background: '#1a1a24', borderRadius: 8, flex: '1 1 150px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Đã kiểm tra</span>
            <div className="stat-value" style={{ fontSize: 22, fontWeight: 700 }}>
              {summary.totalHosts ?? 0}
              <span className="text-muted" style={{ fontSize: 13, marginLeft: 4 }}>hosts</span>
            </div>
          </div>
          {/* Known-good pool */}
          <div className="stat-card" style={{ padding: '10px 16px', background: '#0f2d0f', borderRadius: 8, flex: '1 1 150px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Pool sẵn sàng</span>
            <div className="stat-value" style={{ fontSize: 22, fontWeight: 700, color: '#4ade80' }}>
              {summary.knownGood ?? 0}
              <span className="text-muted" style={{ fontSize: 13, marginLeft: 4 }}>known-good</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Per-line detail ─────────────────────────────────────────────── */}
      {summary.totalHosts != null && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {GPU_LINES.map((line) => {
            const count = summary.knownGoodByLine?.[line.key] ?? 0;
            const target = draft.targetPerLine[line.key] ?? 4;
            const ok = count >= target;
            return (
              <div
                key={line.key}
                className="stat-card"
                style={{
                  padding: '8px 14px',
                  background: ok ? '#1a241a' : '#241a1a',
                  borderRadius: 8,
                }}
              >
                <span className="text-muted" style={{ fontSize: 12 }}>{line.label.split(' ')[1]}</span>
                <div className="stat-value" style={{ fontSize: 20, fontWeight: 700, color: ok ? '#4ade80' : '#f87171' }}>
                  {count}
                  <span className="text-muted" style={{ fontSize: 12, marginLeft: 4 }}>/ {target}</span>
                </div>
              </div>
            );
          })}
          {summary.stale != null && (
            <div className="stat-card" style={{ padding: '8px 14px', background: '#1a1a24', borderRadius: 8 }}>
              <span className="text-muted" style={{ fontSize: 12 }}>Cần recheck</span>
              <div className="stat-value" style={{ fontSize: 20, fontWeight: 700, color: '#fbbf24' }}>
                {summary.stale}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── System toggle ──────────────────────────────────────────────── */}
      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={saving}
            onChange={(e) => setDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
            style={{ width: 18, height: 18, cursor: 'pointer' }}
          />
          <span style={{ color: draft.enabled ? '#4ade80' : '#9ca3af' }}>
            {draft.enabled ? '🟢 Đang bật' : '⚫ Đang tắt'}
          </span>
        </label>
        <span className="text-muted" style={{ fontSize: 13 }}>
          Tắt để dừng toàn bộ cron Host Intelligence
        </span>
      </div>

      {/* ── Provider toggles ───────────────────────────────────────────── */}
      <div className="stat-label" style={{ marginTop: 20 }}>Providers</div>
      <div style={{ marginTop: 8, display: 'flex', gap: 24 }}>
        {PROVIDERS.map((prov) => (
          <label
            key={prov.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              opacity: draft.enabled ? 1 : 0.5,
            }}
          >
            <input
              type="checkbox"
              checked={draft.providers[prov.key] ?? false}
              disabled={saving || !draft.enabled}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  providers: { ...prev.providers, [prov.key]: e.target.checked },
                }))
              }
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <span style={{ color: draft.providers[prov.key] ? '#4ade80' : '#9ca3af' }}>
              {prov.label}
            </span>
          </label>
        ))}
      </div>

      {/* ── Target per GPU line ────────────────────────────────────────── */}
      <div className="stat-label" style={{ marginTop: 20 }}>Số known-good mục tiêu mỗi dòng GPU</div>
      <div className="stat-sub" style={{ marginTop: 4 }}>
        Khi pool dưới mục tiêu, cron sẽ test nhiều host hơn mỗi chu kỳ
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {GPU_LINES.map((line) => (
          <label
            key={line.key}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              opacity: draft.enabled ? 1 : 0.5,
            }}
          >
            <span style={{ fontSize: 13, color: '#9ca3af' }}>{line.label}</span>
            <input
              type="number"
              className="gpu-edit-field mono"
              style={{ width: 80 }}
              min={0}
              max={20}
              step={1}
              disabled={saving || !draft.enabled}
              value={draft.targetPerLine[line.key] ?? 4}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  targetPerLine: { ...prev.targetPerLine, [line.key]: Math.max(0, Number(e.target.value) || 0) },
                }))
              }
            />
          </label>
        ))}
      </div>

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <button
          type="button"
          className={`btn ${hasChanges ? 'btn-primary' : ''}`}
          disabled={saving || !hasChanges}
          onClick={() => void handleSave()}
        >
          {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
        </button>
        {hasChanges && (
          <button type="button" className="btn" disabled={saving} onClick={handleUndo}>
            Hoàn tác
          </button>
        )}
        {toast ? (
          <div className="admin-pricing-toast" role="status" aria-live="polite">
            ✓ {toast}
          </div>
        ) : null}
      </div>
    </div>
  );
}
