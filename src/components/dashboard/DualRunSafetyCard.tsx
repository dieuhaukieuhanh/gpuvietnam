import { useCallback, useEffect, useState } from 'react';

type DualRunState = {
  title: string;
  short: string;
  costWarning: string;
  notResume: string;
  sameGpuNote?: string;
  enabled: boolean;
  canEnable: boolean;
  gpuLine?: string | null;
  capacityMessage?: string | null;
  billing: {
    customerMultiplier: number;
    multiplierMin: number;
    multiplierMax: number;
    hardCapMultiplier: number;
  };
  eligibility?: { reason?: string; message?: string };
};

type DualRunSafetyCardProps = {
  accessToken: string | undefined;
  planKey?: string | null;
  /** GPU line of running machine / active package (e.g. rtx4090_1x). */
  activeGpuLine?: string | null;
};

/**
 * B3.3 — Toggle / copy for “Render an toàn” (2 GPU dual-run policy).
 * Second GPU = same type as active package; different host.
 */
export default function DualRunSafetyCard({
  accessToken,
  planKey,
  activeGpuLine,
}: DualRunSafetyCardProps) {
  const [state, setState] = useState<DualRunState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) {
      setState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (planKey) qs.set('planKey', planKey);
      if (activeGpuLine) qs.set('activeGpuLine', activeGpuLine);
      qs.set('enabled', enabled ? '1' : '0');
      qs.set('probe', '1');
      const res = await fetch(`/api/cp/dual-run?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi tải dual-run');
      setState(data.dualRun ?? null);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Lỗi');
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, planKey, activeGpuLine, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const onToggle = async () => {
    if (!accessToken || !state?.canEnable) return;
    const next = !enabled;
    setEnabled(next);
    setMsg(null);
    try {
      const res = await fetch('/api/cp/dual-run', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planKey,
          activeGpuLine,
          enabled: next,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không cập nhật được');
      setState(data.dualRun ?? null);
      if (data.blocked) {
        setEnabled(false);
        setMsg(data.capacity?.message || data.dualRun?.capacityMessage || 'Không đủ 2 host.');
        return;
      }
      setMsg(
        next
          ? `Đã bật Render an toàn (${data.dualRun?.gpuLine || 'cùng GPU gói'}).`
          : 'Đã tắt Render an toàn.',
      );
    } catch (err) {
      setEnabled(!next);
      setMsg(err instanceof Error ? err.message : 'Lỗi');
    }
  };

  return (
    <div className="card" style={{ marginTop: 0 }}>
      <div className="card-header">
        <span className="card-title">RENDER AN TOÀN</span>
      </div>
      {loading && !state ? (
        <p className="dashboard-stat-empty">Đang tải...</p>
      ) : !state ? (
        <p className="dashboard-stat-empty">{msg || 'Không tải được cấu hình.'}</p>
      ) : (
        <>
          <p style={{ fontSize: 13, margin: '0 0 8px', lineHeight: 1.45 }}>{state.short}</p>
          {state.sameGpuNote ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.45 }}>
              {state.sameGpuNote}
              {state.gpuLine ? ` (hiện tại: ${state.gpuLine})` : ''}
            </p>
          ) : null}
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.45 }}>
            {state.costWarning}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
            {state.notResume}
          </p>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 13,
              opacity: state.canEnable ? 1 : 0.55,
            }}
          >
            <input
              type="checkbox"
              checked={enabled && state.canEnable}
              disabled={!state.canEnable}
              onChange={() => void onToggle()}
            />
            Bật chạy 2 GPU cùng loại, khác host
          </label>
          {!state.canEnable ? (
            <p style={{ fontSize: 12, color: '#fbbf24', marginTop: 8 }}>
              {state.capacityMessage ||
                state.eligibility?.message ||
                'Chỉ gói Pro/Studio (và đủ 2 host cùng loại GPU). Starter dùng failover tuần tự.'}
            </p>
          ) : null}
          {state.capacityMessage && state.canEnable ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              {state.capacityMessage}
            </p>
          ) : null}
          {msg ? (
            <p style={{ fontSize: 12, marginTop: 8, color: 'var(--accent-blue)' }}>{msg}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
