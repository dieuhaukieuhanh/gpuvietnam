import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-session';

type HostIntelligenceConfig = {
  enabled: boolean;
  targetPerLine: Record<string, number>;
  providers: Record<string, boolean>;
};

type LineInventory = {
  available: number;
  inBook: number;
  target: number;
  ok: boolean;
};

type HostIntelligenceSummary = {
  totalHosts?: number;
  knownGood?: number;
  knownGoodByLine?: Record<string, number>;
  availableByLine?: Record<string, number>;
  availableTotal?: number;
  marketCandidateCountByLine?: Record<string, number>;
  marketProbe?: string;
  lines?: Record<string, LineInventory>;
  stale?: number;
  blacklisted?: number;
  inCooldown?: number;
  averagePassRate?: number | null;
  probedAt?: string;
  [key: string]: unknown;
};

type HostIntelligenceResponse = {
  config: HostIntelligenceConfig;
  summary: HostIntelligenceSummary;
  error?: string;
};

const GPU_LINES: { key: string; label: string; short: string; plan: string; ssdGb: number }[] = [
  { key: 'rtx3090', label: 'Starter · RTX 3090 · 50GB', short: 'Starter', plan: 'starter', ssdGb: 50 },
  { key: 'rtx4090_1x', label: 'Pro · RTX 4090 · 80GB', short: 'Pro', plan: 'pro', ssdGb: 80 },
  { key: 'rtx5090_1x', label: 'Studio · RTX 5090 · 120GB', short: 'Studio', plan: 'studio', ssdGb: 120 },
];

/** Admin: Host Intelligence — Vast only (live cron + chợ). */
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
      setError('Lỗi mạng khi tải cấu hình Host Intelligence (Vast).');
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
      // Preserve Clore toggle from sibling card; this card owns Vast + master enabled + targets.
      const payload = {
        enabled: draft.enabled,
        targetPerLine: draft.targetPerLine,
        providers: {
          ...saved.providers,
          vast: draft.providers.vast ?? true,
        },
      };
      const res = await adminFetch('/api/admin/host-intelligence-config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = typeof data.detail === 'string' ? data.detail : '';
        alert([data.error ?? 'Lưu thất bại.', detail].filter(Boolean).join('\n'));
        return;
      }
      applyConfig(data.config, data.summary);
      setToast('Đã lưu cấu hình Host Intelligence (Vast)');
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

  const hasChanges = JSON.stringify({
    enabled: draft.enabled,
    targetPerLine: draft.targetPerLine,
    vast: draft.providers.vast,
  }) !== JSON.stringify({
    enabled: saved.enabled,
    targetPerLine: saved.targetPerLine,
    vast: saved.providers.vast,
  });
  const passRate = typeof summary.averagePassRate === 'number' ? summary.averagePassRate : null;
  const marketOk = summary.marketProbe === 'ok';

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="text-muted">Đang tải Host Intelligence (Vast)...</p>
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
      <div className="stat-label">Host Intelligence — Vast.ai</div>
      <div className="stat-sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
        Cron VPS (~25 phút) thuê thử bằng image test nhẹ (~300MB), lọc đúng gói cố định
        (Starter 50GB / Pro 80GB / Studio 120GB). Mục tiêu: giữ đủ máy{' '}
        <strong>đã verify và đang còn trên chợ Vast</strong>. Start ưu tiên pool đúng gói; hết pool thì fallback máy lạ.
      </div>

      {summary.totalHosts != null && (
        <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div className="stat-card" style={{ padding: '10px 16px', background: '#1a1a24', borderRadius: 8, flex: '1 1 200px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Tỉ lệ pass khi test host</span>
            <div
              className="stat-value"
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: passRate != null && passRate >= 60 ? '#4ade80' : '#fbbf24',
              }}
            >
              {passRate != null ? `${passRate}%` : '—'}
            </div>
            <span className="text-muted" style={{ fontSize: 11 }}>
              {passRate != null && passRate > 0
                ? `~${Math.round((100 / passRate) * 10) / 10} lần test → 1 máy tốt`
                : 'Chưa đủ dữ liệu'}
            </span>
          </div>

          <div className="stat-card" style={{ padding: '10px 16px', background: '#0f2d0f', borderRadius: 8, flex: '1 1 150px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Sẵn giao (đúng gói, đang trên chợ)</span>
            <div className="stat-value" style={{ fontSize: 22, fontWeight: 700, color: '#4ade80' }}>
              {marketOk ? (summary.availableTotal ?? 0) : '—'}
              <span className="text-muted" style={{ fontSize: 13, marginLeft: 4 }}>available</span>
            </div>
            <span className="text-muted" style={{ fontSize: 11 }}>
              Known-good online · Start ưu tiên số này
            </span>
          </div>

          <div className="stat-card" style={{ padding: '10px 16px', background: '#1a1a24', borderRadius: 8, flex: '1 1 150px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Trong sổ tay Vast</span>
            <div className="stat-value" style={{ fontSize: 22, fontWeight: 700 }}>
              {summary.knownGood ?? 0}
              <span className="text-muted" style={{ fontSize: 13, marginLeft: 4 }}>known-good</span>
            </div>
            <span className="text-muted" style={{ fontSize: 11 }}>
              Có thể đang bị thuê / hết list
            </span>
          </div>

          <div className="stat-card" style={{ padding: '10px 16px', background: '#1a1a24', borderRadius: 8, flex: '1 1 120px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Đã ghi nhận</span>
            <div className="stat-value" style={{ fontSize: 22, fontWeight: 700 }}>
              {summary.totalHosts ?? 0}
              <span className="text-muted" style={{ fontSize: 13, marginLeft: 4 }}>hosts</span>
            </div>
          </div>
        </div>
      )}

      {summary.totalHosts != null && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {GPU_LINES.map((line) => {
            const target = draft.targetPerLine[line.key] ?? 4;
            const available = marketOk
              ? (summary.availableByLine?.[line.key] ?? summary.lines?.[line.key]?.available ?? 0)
              : null;
            const inBook = summary.knownGoodByLine?.[line.key] ?? summary.lines?.[line.key]?.inBook ?? 0;
            const ok = available != null && available >= target;
            return (
              <div
                key={line.key}
                className="stat-card"
                style={{
                  padding: '8px 14px',
                  background: available == null ? '#1a1a24' : ok ? '#1a241a' : '#241a1a',
                  borderRadius: 8,
                  minWidth: 140,
                }}
              >
                <span className="text-muted" style={{ fontSize: 12 }}>{line.label}</span>
                <div
                  className="stat-value"
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: available == null ? '#9ca3af' : ok ? '#4ade80' : '#f87171',
                  }}
                >
                  {available == null ? '—' : available}
                  <span className="text-muted" style={{ fontSize: 12, marginLeft: 4 }}>/ {target}</span>
                </div>
                <span className="text-muted" style={{ fontSize: 11 }}>
                  sẵn giao · sổ tay {inBook}
                </span>
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

      {!marketOk && summary.marketProbe && (
        <div className="stat-sub" style={{ marginTop: 10, color: '#fbbf24' }}>
          Không probe được chợ Vast (`{summary.marketProbe}`) — đang chỉ hiện số trong sổ tay.
        </div>
      )}

      {summary.probedAt && marketOk && (
        <div className="stat-sub" style={{ marginTop: 8, fontSize: 11 }}>
          Cập nhật tồn kho chợ Vast: {new Date(summary.probedAt).toLocaleString('vi-VN')}
          {' · '}
          <button
            type="button"
            className="btn"
            style={{ padding: '2px 8px', fontSize: 11 }}
            onClick={() => void load()}
          >
            Làm mới
          </button>
        </div>
      )}

      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={saving}
            onChange={(e) => setDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
            style={{ width: 18, height: 18, cursor: 'pointer' }}
          />
          <span style={{ color: draft.enabled ? '#4ade80' : '#9ca3af' }}>
            {draft.enabled ? '🟢 Cron Host Intelligence đang bật' : '⚫ Cron Host Intelligence đang tắt'}
          </span>
        </label>
        <label
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
            checked={draft.providers.vast ?? true}
            disabled={saving || !draft.enabled}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                providers: { ...prev.providers, vast: e.target.checked },
              }))
            }
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <span style={{ color: draft.providers.vast ? '#4ade80' : '#9ca3af' }}>Quét Vast</span>
        </label>
      </div>

      <div className="stat-label" style={{ marginTop: 20 }}>Mục tiêu sẵn giao mỗi gói</div>
      <div className="stat-sub" style={{ marginTop: 4 }}>
        Đếm known-good <strong>đúng gói (SSD cố định)</strong> và còn trên chợ Vast. Gói dưới target được cron ưu tiên test bù.
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
                  targetPerLine: {
                    ...prev.targetPerLine,
                    [line.key]: Math.max(0, Number(e.target.value) || 0),
                  },
                }))
              }
            />
          </label>
        ))}
      </div>

      <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <button
          type="button"
          className={`btn ${hasChanges ? 'btn-primary' : ''}`}
          disabled={saving || !hasChanges}
          onClick={() => void handleSave()}
        >
          {saving ? 'Đang lưu…' : 'Lưu cấu hình Vast'}
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
