import { useCallback, useEffect, useState } from 'react';

type DualRunState = {
  title: string;
  short: string;
  costWarning: string;
  notResume: string;
  enabled: boolean;
  canEnable: boolean;
  billing: {
    multiplierMin: number;
    multiplierMax: number;
    hardCapMultiplier: number;
  };
  eligibility?: { reason?: string; message?: string };
};

type DualRunSafetyCardProps = {
  accessToken: string | undefined;
  planKey?: string | null;
};

/**
 * B3.3 — Toggle / copy for “Render an toàn” (2 GPU dual-run policy).
 */
export default function DualRunSafetyCard({ accessToken, planKey }: DualRunSafetyCardProps) {
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
      qs.set('enabled', enabled ? '1' : '0');
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
  }, [accessToken, planKey, enabled]);

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
          enabled: next,
          availableHostCount: 2,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không cập nhật được');
      setState(data.dualRun ?? null);
      setMsg(next ? data.dualRun?.title && 'Đã bật Render an toàn.' : 'Đã tắt Render an toàn.');
    } catch (err) {
      setEnabled(!next);
      setMsg(err instanceof Error ? err.message : 'Lỗi');
    }
  };

  return (
    <div className="card" style={{ marginTop: 0 }}>
      <div className="card-header">
        <span className="card-title">🛡️ RENDER AN TOÀN</span>
      </div>
      {loading && !state ? (
        <p className="dashboard-stat-empty">Đang tải...</p>
      ) : !state ? (
        <p className="dashboard-stat-empty">{msg || 'Không tải được cấu hình.'}</p>
      ) : (
        <>
          <p style={{ fontSize: 13, margin: '0 0 8px', lineHeight: 1.45 }}>{state.short}</p>
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
            Bật chạy 2 GPU song song (dual-run)
          </label>
          {!state.canEnable ? (
            <p style={{ fontSize: 12, color: '#fbbf24', marginTop: 8 }}>
              {state.eligibility?.message ||
                'Chỉ gói Pro/Studio (hoặc khi đủ 2 máy). Starter dùng failover Attempt tuần tự.'}
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
