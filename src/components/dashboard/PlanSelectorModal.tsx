import { useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '@/lib/gpu-pricing';

export type ActivePlan = {
  id: string;
  inventoryId?: number;
  subscriptionId?: string | null;
  type: 'main' | 'gift';
  plan_type?: 'combo' | 'hourly' | 'gift';
  plan: 'starter' | 'pro' | 'studio';
  gpu: string;
  vram: string;
  hours_remaining: number;
  price_per_hour: number;
  expires_at?: string | null;
  label: string;
  badge: string;
};

type PlanSelectorModalProps = {
  open: boolean;
  plans: ActivePlan[];
  loading?: boolean;
  onClose: () => void;
  onConfirm: (plan: ActivePlan) => void | Promise<void>;
};

function planTitle(plan: ActivePlan): string {
  const name = plan.plan.charAt(0).toUpperCase() + plan.plan.slice(1);
  return `${name} (${plan.gpu} · ${plan.vram})`;
}

function formatExpiry(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('vi-VN');
}

function daysUntilExpiry(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function badgeClass(plan: ActivePlan): string {
  if (plan.plan_type === 'gift' || plan.type === 'gift') return 'plan-selector-badge gift';
  if (plan.plan_type === 'hourly') return 'plan-selector-badge hourly';
  if (plan.plan === 'starter') return 'plan-selector-badge starter';
  if (plan.plan === 'studio') return 'plan-selector-badge studio';
  return 'plan-selector-badge pro';
}

export default function PlanSelectorModal({
  open,
  plans,
  loading = false,
  onClose,
  onConfirm,
}: PlanSelectorModalProps) {
  const defaultId = useMemo(
    () => plans.find((p) => p.type === 'main')?.id ?? plans[0]?.id ?? '',
    [plans],
  );
  const [selectedId, setSelectedId] = useState(defaultId);

  useEffect(() => {
    if (open) setSelectedId(defaultId);
  }, [open, defaultId]);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const selected = plans.find((p) => p.id === selectedId) ?? plans[0];

  return (
    <div className="plan-selector-overlay" onClick={onClose} role="presentation">
      <div
        className="plan-selector-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-selector-title"
      >
        <h3 id="plan-selector-title">Chọn cấu hình khởi động</h3>
        <p className="plan-selector-subtitle">
          Bạn có {plans.length} gói đang hoạt động. Chọn gói muốn dùng:
        </p>

        <div className="plan-selector-list">
          {plans.map((plan) => {
            const isSelected = selected?.id === plan.id;
            const expiry = formatExpiry(plan.expires_at);
            const daysLeft = daysUntilExpiry(plan.expires_at);
            const expiringSoon = plan.type === 'gift' && daysLeft !== null && daysLeft >= 0 && daysLeft < 3;

            return (
              <button
                key={plan.id}
                type="button"
                className={`plan-selector-card${isSelected ? ' selected' : ''}`}
                onClick={() => setSelectedId(plan.id)}
              >
                <div className="plan-selector-card-head">
                  <span className="plan-selector-radio">{isSelected ? '●' : '○'}</span>
                  <strong>{planTitle(plan)}</strong>
                </div>
                <div className="plan-selector-card-meta">
                  {plan.type === 'gift' ? (
                    <>
                      {plan.hours_remaining}h tặng
                      {expiry ? ` · Hết hạn ${expiry}` : ''}
                    </>
                  ) : (
                    <>{plan.hours_remaining}h còn lại</>
                  )}
                </div>
                <div className="plan-selector-card-price">
                  {plan.price_per_hour > 0
                    ? `${formatCurrency(plan.price_per_hour)}/h`
                    : 'Miễn phí'}
                </div>
                <span className={badgeClass(plan)}>{plan.badge}</span>
                {expiringSoon && (
                  <div className="plan-selector-expiry-warn">⚠️ Sắp hết hạn</div>
                )}
              </button>
            );
          })}
        </div>

        <p className="plan-selector-tip">
          💡 Gói tặng dùng hết sẽ tự động quay về gói thường.
        </p>

        <div className="plan-selector-actions">
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={onClose}>
            Hủy
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || !selected}
            onClick={() => selected && void onConfirm(selected)}
          >
            {loading ? 'Đang khởi động...' : '🚀 Khởi động máy'}
          </button>
        </div>
      </div>
    </div>
  );
}
