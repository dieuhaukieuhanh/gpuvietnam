import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { BillingMode } from '@/lib/checkout-plans';
import { BILLING_LABELS } from '@/lib/checkout-plans';
import RenewPlanModal from '@/components/dashboard/RenewPlanModal';
import { useGpuPricingConfig } from '@/hooks/useGpuPricingConfig';
import type { BillingSessionView, DashboardSubscription } from '@/hooks/useDashboard';
import { notifyUserPlansChanged } from '@/hooks/useUserPlans';
import { mergeBillingSessionViewOnPoll } from '@/lib/scb-ui-view-model';
import { formatDisplayHours } from '@/lib/dashboard-session-display';
import {
  resolvePlanCardHours,
  resolvePlanCardValidUntil,
} from '@/lib/plan-card-display';
import {
  formatCurrency,
  getPlanConfig,
  getPlanNameFromKey,
  getPlanPrice,
  PLAN_ORDER,
} from '@/lib/gpu-pricing';
import { routes } from '@/lib/routes';

type InventoryPlan = {
  id: number;
  planType: 'combo' | 'hourly' | 'gift';
  planTypeLabel: string;
  planName: string;
  displayName: string;
  gpu: string;
  vram: string;
  hoursTotal: number;
  hoursRemaining: number;
  pricePerHour: number;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  status: string;
  source: string;
  billing: string | null;
  grantId: number | null;
  subscriptionId: string | null;
  usable: boolean;
  statusBadge: string;
};

type PlansResponse = {
  items: InventoryPlan[];
  usable: InventoryPlan[];
  inactive: InventoryPlan[];
  activePlan: InventoryPlan | null;
  count: number;
  error?: string;
};

type MeResponse = {
  hasUsedTrial?: boolean;
  subscription?: DashboardSubscription | null;
  billingView?: BillingSessionView | null;
  error?: string;
};

type MyPlanPanelProps = {
  accessToken: string | undefined;
  subscription?: DashboardSubscription | null;
  billingView?: BillingSessionView | null;
  onBillingRefresh?: (options?: { silent?: boolean }) => void | Promise<void>;
};

type PlanHoursOverlay = {
  hoursRemaining: number;
  hoursTotal: number;
  validUntil: string | null;
};

function resolveActivePlanHoursOverlay(
  plan: InventoryPlan,
  subscription: DashboardSubscription | null | undefined,
  billingView: BillingSessionView | null | undefined,
): PlanHoursOverlay {
  const { hoursRemaining, hoursTotal } = resolvePlanCardHours({
    inventoryHoursRemaining: plan.hoursRemaining,
    inventoryHoursTotal: plan.hoursTotal,
    subscriptionPackageHours: subscription?.hours_total ?? null,
    billingView,
  });

  return {
    hoursRemaining,
    hoursTotal,
    validUntil: resolvePlanCardValidUntil(plan.validUntil, subscription?.expires_at ?? null),
  };
}

type RenewTarget = {
  planName: string;
  billing: BillingMode;
};

function formatDate(iso: string | null): string {
  if (!iso) return 'Không giới hạn';
  return new Date(iso).toLocaleDateString('vi-VN');
}

function resolveBilling(plan: InventoryPlan): BillingMode {
  if (plan.billing === 'hourly' || plan.billing === 'combo1' || plan.billing === 'combo2') {
    return plan.billing;
  }
  return plan.planType === 'hourly' ? 'hourly' : 'combo1';
}

function canRenew(plan: InventoryPlan): boolean {
  return plan.planType === 'combo' && plan.billing !== 'hourly' && plan.billing !== null;
}

function PlanHero() {
  return (
    <div className="my-plan-hero">
      <h2>📦 Gói của tôi</h2>
      <p>Quản lý tất cả gói GPU đang sở hữu — chọn gói dùng, tái tục hoặc mua thêm.</p>
    </div>
  );
}

function NoPlanView({ hasUsedTrial }: { hasUsedTrial: boolean }) {
  return (
    <div className="my-plan-panel">
      <PlanHero />
      <div className="card my-plan-welcome">
        <div className="my-plan-welcome-icon">🎉</div>
        <p className="my-plan-welcome-text">
          Bạn chưa có gói GPU nào. Chọn gói phù hợp để bắt đầu sáng tạo ngay!
        </p>
        <div className="my-plan-picker-grid">
          {PLAN_ORDER.map((planKey) => {
            const config = getPlanConfig(planKey);
            const planName = getPlanNameFromKey(planKey);
            if (!config || !planName) return null;
            return (
              <div key={planKey} className="my-plan-picker-card">
                <div className="my-plan-picker-name">{planName}</div>
                <div className="my-plan-picker-spec">
                  {config.gpu} · {config.vram}
                </div>
                <div className="my-plan-picker-price">
                  {formatCurrency(config.price_per_hour)}/giờ
                </div>
                <Link href={routes.bangGia} className="btn btn-secondary btn-sm">
                  Chọn
                </Link>
              </div>
            );
          })}
        </div>
        {!hasUsedTrial && (
          <Link href={`${routes.register}?trial=true`} className="my-plan-trial-link">
            Dùng thử miễn phí 3 giờ
          </Link>
        )}
      </div>
      <Link href={routes.bangGia} className="my-plan-footer-link">
        + Mua thêm gói →
      </Link>
    </div>
  );
}

type PlanCardProps = {
  plan: InventoryPlan;
  hoursOverlay?: PlanHoursOverlay;
  otherUsableCount: number;
  actionBusy: boolean;
  renewPrice: number;
  onActivate: (id: number) => void;
  onDeactivate: (id: number) => void;
  onRenew: (target: RenewTarget) => void;
};

function PlanCard({
  plan,
  hoursOverlay,
  otherUsableCount,
  actionBusy,
  renewPrice,
  onActivate,
  onDeactivate,
  onRenew,
}: PlanCardProps) {
  const billing = resolveBilling(plan);
  const billingLabel = plan.billing ? BILLING_LABELS[billing] ?? plan.billing : plan.planTypeLabel;
  const isActiveUsing = plan.isActive && plan.usable;
  const hoursRemaining = hoursOverlay?.hoursRemaining ?? plan.hoursRemaining;
  const hoursTotal = hoursOverlay?.hoursTotal ?? plan.hoursTotal;
  const validUntil = hoursOverlay?.validUntil ?? plan.validUntil;

  return (
    <div
      className={`my-plan-inventory-card${isActiveUsing ? ' is-active' : ''}${!plan.usable ? ' is-inactive' : ''}`}
    >
      <div className="my-plan-inventory-head">
        <div className="my-plan-inventory-icon">{plan.planTypeLabel.split(' ')[0]}</div>
        <div>
          <div className="my-plan-inventory-title">
            {plan.displayName}
            <span className="my-plan-inventory-gpu">
              {plan.gpu} · {plan.vram}
            </span>
          </div>
          <div className="my-plan-inventory-meta">
            Còn lại {formatDisplayHours(hoursRemaining)}
            {hoursTotal > 0 ? ` / ${formatDisplayHours(hoursTotal)}` : ''}
            {' · '}
            Hạn: {formatDate(validUntil)}
          </div>
        </div>
        <span
          className={`my-plan-inventory-badge${isActiveUsing ? ' active' : plan.usable ? ' ready' : ' muted'}`}
        >
          {plan.statusBadge}
        </span>
      </div>

      <div className="my-plan-inventory-tags">
        <span className="my-plan-inventory-tag">{plan.planTypeLabel}</span>
        {plan.billing && plan.planType === 'combo' && (
          <span className="my-plan-inventory-tag">{billingLabel}</span>
        )}
      </div>

      {plan.usable && (
        <div className="my-plan-inventory-actions">
          {!plan.isActive && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={actionBusy}
              onClick={() => onActivate(plan.id)}
            >
              ▶️ Dùng gói này
            </button>
          )}
          {plan.isActive && otherUsableCount > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={actionBusy}
              onClick={() => onDeactivate(plan.id)}
            >
              ⏸️ Dừng dùng
            </button>
          )}
          {canRenew(plan) && (
            <button
              type="button"
              className="btn btn-primary btn-sm my-plan-renew-btn"
              disabled={actionBusy}
              onClick={() =>
                onRenew({
                  planName: plan.planName,
                  billing: billing as BillingMode,
                })
              }
            >
              🔄 Tái tục{renewPrice > 0 ? ` · ${formatCurrency(renewPrice)}` : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function MyPlanPanel({
  accessToken,
  subscription: subscriptionProp,
  billingView: billingViewProp,
  onBillingRefresh,
}: MyPlanPanelProps) {
  useGpuPricingConfig();
  const [plansData, setPlansData] = useState<PlansResponse | null>(null);
  const [hasUsedTrial, setHasUsedTrial] = useState(false);
  const [meSubscription, setMeSubscription] = useState<DashboardSubscription | null>(null);
  const [meBillingView, setMeBillingView] = useState<BillingSessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [renewTarget, setRenewTarget] = useState<RenewTarget | null>(null);
  const [toast, setToast] = useState('');

  const loadPlans = useCallback(async () => {
    if (!accessToken) {
      setPlansData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [plansRes, meRes] = await Promise.all([
        fetch('/api/user/plans', { headers: { Authorization: `Bearer ${accessToken}` } }),
        fetch('/api/dashboard/me', { headers: { Authorization: `Bearer ${accessToken}` } }),
        fetch('/api/user/auto-renew/check', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);

      const plansResult = (await plansRes.json()) as PlansResponse;
      const meResult = (await meRes.json()) as MeResponse;

      if (!plansRes.ok) {
        setError(plansResult.error ?? 'Không tải được danh sách gói.');
        return;
      }

      setPlansData(plansResult);
      setHasUsedTrial(Boolean(meResult.hasUsedTrial));
      setMeSubscription(meResult.subscription ?? null);
      setMeBillingView((prev) =>
        mergeBillingSessionViewOnPoll(prev, meResult.billingView ?? null) as BillingSessionView | null,
      );
    } catch {
      setError('Không tải được gói của bạn.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (!accessToken) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void loadPlans();
      void onBillingRefresh?.({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [accessToken, loadPlans, onBillingRefresh]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const handleActivate = async (inventoryId: number) => {
    if (!accessToken) return;
    setActionBusy(true);
    try {
      const res = await fetch('/api/user/plans/activate', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inventoryId, action: 'activate' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast(data.error ?? 'Không đổi được gói.');
        return;
      }
      setToast('Đã chọn gói đang dùng.');
      notifyUserPlansChanged();
      await onBillingRefresh?.({ silent: true });
      await loadPlans();
    } catch {
      setToast('Lỗi mạng khi đổi gói.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeactivate = async (inventoryId: number) => {
    if (!accessToken) return;
    setActionBusy(true);
    try {
      const res = await fetch('/api/user/plans/activate', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inventoryId, action: 'deactivate' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast(data.error ?? 'Không dừng được gói.');
        return;
      }
      setToast('Đã dừng dùng gói này.');
      notifyUserPlansChanged();
      await onBillingRefresh?.({ silent: true });
      await loadPlans();
    } catch {
      setToast('Lỗi mạng.');
    } finally {
      setActionBusy(false);
    }
  };

  const activePlan = plansData?.activePlan ?? null;
  const usablePlans = plansData?.usable ?? [];
  const inactivePlans = plansData?.inactive ?? [];
  const otherUsableCount = Math.max(0, usablePlans.length - 1);
  const subscription = subscriptionProp ?? meSubscription;
  const billingView = billingViewProp ?? meBillingView;
  const activePlanHoursOverlay =
    activePlan != null
      ? resolveActivePlanHoursOverlay(activePlan, subscription, billingView)
      : undefined;

  const getRenewPrice = useCallback(
    (plan: InventoryPlan) => {
      if (!canRenew(plan)) return 0;
      const billing = resolveBilling(plan);
      return getPlanPrice(plan.planName, billing);
    },
    [],
  );

  if (loading) {
    return (
      <div className="card my-plan-panel" style={{ textAlign: 'center', padding: 48 }}>
        <p style={{ color: 'var(--text-muted)' }}>Đang tải gói của bạn...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card my-plan-panel" style={{ textAlign: 'center', padding: 48 }}>
        <p className="error-msg" style={{ marginBottom: 16 }}>
          {error}
        </p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadPlans()}>
          Thử lại
        </button>
      </div>
    );
  }

  if (!plansData?.items?.length) {
    return <NoPlanView hasUsedTrial={hasUsedTrial} />;
  }

  return (
    <div className="my-plan-panel">
      <PlanHero />

      {activePlan && (
        <div className="my-plan-active-highlight">
          <div className="my-plan-active-label">Gói đang dùng</div>
          <PlanCard
            plan={activePlan}
            hoursOverlay={activePlanHoursOverlay}
            otherUsableCount={otherUsableCount}
            actionBusy={actionBusy}
            renewPrice={getRenewPrice(activePlan)}
            onActivate={handleActivate}
            onDeactivate={handleDeactivate}
            onRenew={setRenewTarget}
          />
        </div>
      )}

      {usablePlans.filter((p) => !p.isActive).length > 0 && (
        <div className="my-plan-section">
          <h3 className="my-plan-section-title">Gói sẵn sàng</h3>
          {usablePlans
            .filter((p) => !p.isActive)
            .map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                otherUsableCount={usablePlans.length - 1}
                actionBusy={actionBusy}
                renewPrice={getRenewPrice(plan)}
                onActivate={handleActivate}
                onDeactivate={handleDeactivate}
                onRenew={setRenewTarget}
              />
            ))}
        </div>
      )}

      {inactivePlans.length > 0 && (
        <div className="my-plan-section my-plan-section-inactive">
          <h3 className="my-plan-section-title">Gói đã hết / hết hạn</h3>
          {inactivePlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              otherUsableCount={0}
              actionBusy={actionBusy}
              renewPrice={getRenewPrice(plan)}
              onActivate={handleActivate}
              onDeactivate={handleDeactivate}
              onRenew={setRenewTarget}
            />
          ))}
        </div>
      )}

      <Link href={routes.bangGia} className="btn btn-secondary my-plan-buy-more">
        + Mua thêm gói
      </Link>

      {renewTarget && accessToken && (
        <RenewPlanModal
          open={Boolean(renewTarget)}
          accessToken={accessToken}
          planName={renewTarget.planName}
          billing={renewTarget.billing}
          onClose={() => setRenewTarget(null)}
          onSuccess={() => {
            setToast('Tái tục thành công!');
            notifyUserPlansChanged();
            void onBillingRefresh?.({ silent: true });
            void loadPlans();
          }}
          onPendingSubmitted={() => {
            setToast('Yêu cầu tái tục đã gửi — chờ Admin duyệt 5–15 phút.');
          }}
        />
      )}

      {toast && <div className="my-plan-toast">{toast}</div>}
    </div>
  );
}
