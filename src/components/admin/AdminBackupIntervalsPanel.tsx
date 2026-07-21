import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-session';

type PlanKey = 'starter' | 'pro' | 'studio';

type PlanIntervals = {
  outputsSec: number;
  workflowsSec: number;
};

type IntervalsByPlan = Record<PlanKey, PlanIntervals>;

const PLAN_ROWS: { key: PlanKey; label: string }[] = [
  { key: 'starter', label: 'Starter' },
  { key: 'pro', label: 'Pro' },
  { key: 'studio', label: 'Studio' },
];

function secToMinutesInput(sec: number) {
  const mins = sec / 60;
  if (Number.isInteger(mins)) return String(mins);
  return String(Math.round(mins * 10) / 10);
}

function minutesInputToSec(value: string, fallbackSec: number) {
  const n = Number(String(value).replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0) return fallbackSec;
  return Math.max(30, Math.round(n * 60));
}

/** Admin: chỉnh chu kỳ auto backup (outputs / workflows) theo 3 gói. */
export default function AdminBackupIntervalsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<PlanKey, { outputsMin: string; workflowsMin: string }>>({
    starter: { outputsMin: '10', workflowsMin: '20' },
    pro: { outputsMin: '3', workflowsMin: '10' },
    studio: { outputsMin: '1', workflowsMin: '5' },
  });
  const [saved, setSaved] = useState<IntervalsByPlan | null>(null);

  const applyIntervals = useCallback((intervals: IntervalsByPlan) => {
    setSaved(intervals);
    setDraft({
      starter: {
        outputsMin: secToMinutesInput(intervals.starter.outputsSec),
        workflowsMin: secToMinutesInput(intervals.starter.workflowsSec),
      },
      pro: {
        outputsMin: secToMinutesInput(intervals.pro.outputsSec),
        workflowsMin: secToMinutesInput(intervals.pro.workflowsSec),
      },
      studio: {
        outputsMin: secToMinutesInput(intervals.studio.outputsSec),
        workflowsMin: secToMinutesInput(intervals.studio.workflowsSec),
      },
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/backup-auto-policy');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Không tải được tần suất backup.');
        return;
      }
      applyIntervals(data.intervals as IntervalsByPlan);
    } catch {
      setError('Lỗi mạng khi tải tần suất backup.');
    } finally {
      setLoading(false);
    }
  }, [applyIntervals]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handleSave = async () => {
    if (!saved) return;
    setSaving(true);
    try {
      const intervals: IntervalsByPlan = {
        starter: {
          outputsSec: minutesInputToSec(draft.starter.outputsMin, saved.starter.outputsSec),
          workflowsSec: minutesInputToSec(draft.starter.workflowsMin, saved.starter.workflowsSec),
        },
        pro: {
          outputsSec: minutesInputToSec(draft.pro.outputsMin, saved.pro.outputsSec),
          workflowsSec: minutesInputToSec(draft.pro.workflowsMin, saved.pro.workflowsSec),
        },
        studio: {
          outputsSec: minutesInputToSec(draft.studio.outputsMin, saved.studio.outputsSec),
          workflowsSec: minutesInputToSec(draft.studio.workflowsMin, saved.studio.workflowsSec),
        },
      };

      const res = await adminFetch('/api/admin/backup-auto-policy', {
        method: 'PUT',
        body: JSON.stringify({ intervals }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? 'Lưu thất bại.');
        return;
      }
      applyIntervals(data.intervals as IntervalsByPlan);
      setToast('Đã lưu tần suất auto backup theo gói');
    } catch {
      alert('Lỗi mạng khi lưu.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="text-muted">Đang tải tần suất backup...</p>
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
      <div className="stat-label">Tần suất auto backup theo gói</div>
      <div className="stat-sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
        Chu kỳ L1 cho <strong>outputs</strong> và <strong>workflows</strong> (phút). Models giữ mặc
        định image. Máy đang chạy chỉ nhận chu kỳ mới sau khi tắt → bật lại. Tối thiểu 0,5 phút
        (30 giây).
      </div>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="pricing-table">
          <thead>
            <tr>
              <th>Gói</th>
              <th>Outputs (phút)</th>
              <th>Workflows (phút)</th>
            </tr>
          </thead>
          <tbody>
            {PLAN_ROWS.map((row, index) => (
              <tr key={row.key} className={index % 2 === 1 ? 'pricing-row-alt' : ''}>
                <td>
                  <strong>{row.label}</strong>
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="pricing-price-input"
                    disabled={saving}
                    value={draft[row.key].outputsMin}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        [row.key]: { ...prev[row.key], outputsMin: e.target.value },
                      }))
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="pricing-price-input"
                    disabled={saving}
                    value={draft[row.key].workflowsMin}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        [row.key]: { ...prev[row.key], workflowsMin: e.target.value },
                      }))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void handleSave()}>
          {saving ? 'Đang lưu…' : 'Lưu tần suất'}
        </button>
        {toast ? (
          <div className="admin-pricing-toast" role="status" aria-live="polite">
            ✓ {toast}
          </div>
        ) : null}
      </div>
    </div>
  );
}
