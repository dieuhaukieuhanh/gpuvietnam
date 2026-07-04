import { useEffect, useState } from 'react';

export type LivePerfMetrics = {
  vram?: { used_gb: number; total_gb: number; percent: number } | null;
  gpu_usage_percent?: number | null;
  temperature?: number | null;
};

type DashboardRealtimePerfCardProps = {
  active: boolean;
  metrics?: LivePerfMetrics | null;
  /** Giá trị cố định khi mock (optional) */
  seedVram?: number;
  seedGpu?: number;
};

function perfColor(pct: number): string {
  if (pct >= 90) return 'var(--accent-red)';
  if (pct >= 70) return 'var(--accent-orange)';
  return 'var(--accent-green)';
}

function gpuColor(pct: number): string {
  if (pct >= 90) return 'var(--accent-red)';
  if (pct >= 70) return 'var(--accent-orange)';
  return 'var(--accent-blue)';
}

export default function DashboardRealtimePerfCard({
  active,
  metrics,
  seedVram,
  seedGpu,
}: DashboardRealtimePerfCardProps) {
  const [vramPct, setVramPct] = useState(seedVram ?? 72);
  const [gpuPct, setGpuPct] = useState(seedGpu ?? 85);
  const [temperature, setTemperature] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return undefined;

    if (metrics?.vram?.percent != null) {
      setVramPct(metrics.vram.percent);
      setGpuPct(metrics.gpu_usage_percent ?? metrics.vram.percent);
      setTemperature(metrics.temperature ?? null);
      return undefined;
    }

    const tick = () => {
      if (seedVram != null && seedGpu != null) {
        setVramPct(Math.min(99, Math.max(55, seedVram + Math.floor(Math.random() * 11) - 5)));
        setGpuPct(Math.min(99, Math.max(50, seedGpu + Math.floor(Math.random() * 15) - 7)));
        return;
      }
      setVramPct(75 + Math.floor(Math.random() * 22));
      setGpuPct(60 + Math.floor(Math.random() * 36));
    };

    tick();
    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, [active, metrics, seedVram, seedGpu]);

  const vramDetail =
    metrics?.vram?.total_gb != null
      ? `${metrics.vram.used_gb ?? 0}GB / ${metrics.vram.total_gb}GB`
      : null;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">⚡ HIỆU SUẤT REALTIME</span>
        {active && (
          <span className="status-badge online" style={{ fontSize: 10 }}>
            <span className="status-dot" />
            Live
          </span>
        )}
      </div>

      <div className="dashboard-perf-body">
      {!active ? (
        <p className="dashboard-stat-empty">Máy chưa chạy — chưa có dữ liệu GPU/VRAM.</p>
      ) : (
        <>
          <div className="perf-row">
            <div className={`perf-item${vramPct >= 90 ? ' alert-flash' : ''}`} id="perfVram">
              <div className="value" style={{ color: perfColor(vramPct) }}>
                {vramPct}%
              </div>
              <div className="label">VRAM{vramDetail ? ` · ${vramDetail}` : ''}</div>
              <div className="progress-bar" style={{ marginTop: 8 }}>
                <div
                  className={`progress-fill${vramPct >= 90 ? ' red' : vramPct >= 70 ? ' orange' : ' green'}`}
                  style={{ width: `${vramPct}%` }}
                />
              </div>
            </div>
            <div className={`perf-item${gpuPct >= 90 ? ' alert-flash' : ''}`} id="perfGpu">
              <div className="value" style={{ color: gpuColor(gpuPct) }}>
                {gpuPct}%
              </div>
              <div className="label">GPU Usage</div>
              <div className="progress-bar" style={{ marginTop: 8 }}>
                <div
                  className={`progress-fill${gpuPct >= 90 ? ' red' : gpuPct >= 70 ? ' orange' : ' blue'}`}
                  style={{ width: `${gpuPct}%` }}
                />
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            🌡️ Nhiệt độ GPU:{' '}
            <strong style={{ color: 'var(--text-secondary)' }}>
              {temperature != null ? `${temperature}°C` : '—'}
            </strong>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
