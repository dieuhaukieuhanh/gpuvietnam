import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BillingMode } from '@/lib/checkout-plans';
import { buildBangGiaCheckoutUrl } from '@/lib/checkout-auth';
import RenewPlanModal from '@/components/dashboard/RenewPlanModal';
import StorageUpgradeCard from '@/components/dashboard/StorageUpgradeCard';
import { useGpuPricingConfig } from '@/hooks/useGpuPricingConfig';
import type { BillingSessionView, DashboardSubscription } from '@/hooks/useDashboard';
import { notifyUserPlansChanged } from '@/hooks/useUserPlans';
import { mergeBillingSessionViewOnPoll } from '@/lib/scb-ui-view-model';
import {
  resolvePlanCardHours,
  BILLING_PACKAGE_LABELS,
  comparePlansByBurnOrder,
  formatPackageRemainingLine,
  getPlanNameFromKey,
  groupInventoryPlansByTier,
  pickTierActivationTarget,
  PLAN_ORDER,
  resolveActiveTierKey,
  resolveInventoryBillingMode,
  getTierPurchaseBillingOptions,
} from '@/lib/plan-card-display';
import {
  formatCurrency,
  getPlanConfig,
  getPlanPrice,
  getPlanPurchaseAmount,
  normalizeHourlyPurchaseHours,
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

type RenewTarget = {
  planName: string;
  billing: BillingMode;
  subscriptionId: string | null;
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
    validUntil: plan.validUntil ?? subscription?.expires_at ?? null,
  };
}

function canRenew(plan: InventoryPlan): boolean {
  return plan.planType === 'combo' && plan.billing !== 'hourly' && plan.billing !== null;
}

function PlanHero() {
  return (
    <div className="my-plan-hero">
      <h2>📦 Gói của tôi</h2>
      <p>
        Chọn gói dịch vụ Starter / Pro / Studio — giờ sắp hết hạn sớm nhất được trừ trước.
      </p>
    </div>
  );
}

const DEFAULT_HOURLY_HOURS = 10;

type PlanPurchaseModalProps = {
  open: boolean;
  tierKey: (typeof PLAN_ORDER)[number];
  onClose: () => void;
  onConfirm: (billing: BillingMode, hourlyHours?: number) => void;
};

function PlanPurchaseModal({ open, tierKey, onClose, onConfirm }: PlanPurchaseModalProps) {
  const tierName = getPlanNameFromKey(tierKey) ?? tierKey;
  const config = getPlanConfig(tierKey);
  const options = useMemo(() => getTierPurchaseBillingOptions(tierKey), [tierKey]);

  const [selectedBilling, setSelectedBilling] = useState<BillingMode>('combo1');
  const [hourlyHours, setHourlyHours] = useState(DEFAULT_HOURLY_HOURS);

  useEffect(() => {
    if (!open) return;
    setSelectedBilling('combo1');
    setHourlyHours(DEFAULT_HOURLY_HOURS);
  }, [open, tierKey]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const normalizedHourlyHours = normalizeHourlyPurchaseHours(hourlyHours);
  const totalAmount = getPlanPurchaseAmount(
    tierName,
    selectedBilling,
    selectedBilling === 'hourly' ? normalizedHourlyHours : undefined,
  );

  const handleConfirm = () => {
    if (selectedBilling === 'hourly') {
      onConfirm('hourly', normalizedHourlyHours);
      return;
    }
    onConfirm(selectedBilling);
  };

  return (
    <div className="renew-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="purchase-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="purchase-modal-title">Mua {tierName}</h3>
        <p className="purchase-modal-spec">
          {config?.gpu ?? 'GPU'} · {config?.vram ?? '—'}
        </p>
        <p className="purchase-modal-hint">Chọn 1 trong 3 hình thức thanh toán</p>

        <div className="purchase-modal-options" role="radiogroup" aria-label="Hình thức thanh toán">
          {options.map((option) => {
            const isSelected = selectedBilling === option.billing;
            const isHourly = option.billing === 'hourly';
            return (
              <label
                key={option.billing}
                className={`purchase-option${isSelected ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="purchase-billing"
                  className="purchase-option-radio"
                  checked={isSelected}
                  onChange={() => setSelectedBilling(option.billing as BillingMode)}
                />
                <div className="purchase-option-body">
                  <div className="purchase-option-head">
                    <span className="purchase-option-title">{option.label}</span>
                    <span className="purchase-option-sep">:</span>
                    {isHourly ? (
                      <span className="purchase-option-hourly-detail">
                        <input
                          id="purchase-hourly-hours"
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          className="purchase-option-hours-input"
                          value={hourlyHours}
                          onClick={(event) => event.stopPropagation()}
                          onFocus={() => setSelectedBilling('hourly')}
                          onChange={(event) => {
                            const next = event.target.value;
                            if (!next) {
                              setHourlyHours(0);
                              return;
                            }
                            setHourlyHours(Number(next));
                          }}
                          onBlur={() => setHourlyHours(normalizeHourlyPurchaseHours(hourlyHours))}
                        />
                        <span className="purchase-option-hours-suffix">h</span>
                        <span className="purchase-option-detail">{option.validitySuffix}</span>
                      </span>
                    ) : (
                      <span className="purchase-option-detail">{option.detail}</span>
                    )}
                  </div>
                  <div className="purchase-option-price">
                    <span className="purchase-option-price-label">Đơn giá</span>
                    <strong>{option.unitPriceLabel}</strong>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <p className="purchase-modal-total">
          Tổng thanh toán: <strong>{formatCurrency(totalAmount)}</strong>
        </p>

        <div className="renew-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Hủy
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selectedBilling === 'hourly' && normalizedHourlyHours < 1}
            onClick={handleConfirm}
          >
            Tiếp tục thanh toán
          </button>
        </div>
      </div>
    </div>
  );
}

type ServiceTierCardProps = {
  tierKey: (typeof PLAN_ORDER)[number];
  plans: InventoryPlan[];
  isSelected: boolean;
  activePlanId: number | null;
  hoursOverlay?: PlanHoursOverlay;
  subscription: DashboardSubscription | null | undefined;
  billingView: BillingSessionView | null | undefined;
  actionBusy: boolean;
  machineSessionActive: boolean;
  onSelectTier: (tierKey: (typeof PLAN_ORDER)[number]) => void;
  onRenew: (target: RenewTarget) => void;
  getRenewPrice: (plan: InventoryPlan) => number;
  onOpenPurchase: () => void;
};

function ServiceTierCard({
  tierKey,
  plans,
  isSelected,
  activePlanId,
  hoursOverlay,
  subscription,
  billingView,
  actionBusy,
  machineSessionActive,
  onSelectTier,
  onRenew,
  getRenewPrice,
  onOpenPurchase,
}: ServiceTierCardProps) {
  const config = getPlanConfig(tierKey);
  const tierName = getPlanNameFromKey(tierKey) ?? tierKey;
  const visiblePlans = useMemo(
    () => plans.filter((plan) => plan.usable).sort(comparePlansByBurnOrder),
    [plans],
  );
  const hasUsable = visiblePlans.length > 0;

  const resolveLineHours = (plan: InventoryPlan) => {
    if (plan.id === activePlanId && hoursOverlay) {
      return {
        hoursRemaining: hoursOverlay.hoursRemaining,
        validUntil: hoursOverlay.validUntil,
      };
    }
    if (plan.isActive && plan.usable) {
      const overlay = resolveActivePlanHoursOverlay(plan, subscription, billingView);
      return {
        hoursRemaining: overlay.hoursRemaining,
        validUntil: overlay.validUntil,
      };
    }
    return {
      hoursRemaining: plan.hoursRemaining,
      validUntil: plan.validUntil,
    };
  };

  return (
    <article
      className={`my-plan-tier-card${isSelected ? ' is-selected' : ''}${!hasUsable ? ' is-empty' : ''}`}
    >
      <label className="my-plan-tier-select">
        <input
          type="radio"
          name="my-plan-active-tier"
          className="my-plan-tier-radio"
          checked={isSelected}
          disabled={actionBusy || !hasUsable || machineSessionActive}
          onChange={() => onSelectTier(tierKey)}
        />
        <span className="my-plan-tier-head">
          <span className="my-plan-tier-name">{tierName}</span>
          <span className="my-plan-tier-spec">
            {config?.gpu ?? 'GPU'} · {config?.vram ?? '—'}
          </span>
        </span>
      </label>
      {machineSessionActive && !isSelected && hasUsable && (
        <p className="stat-sub" style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
          🔒 Tắt máy để đổi sang gói này
        </p>
      )}

      <div className="my-plan-tier-tree" role="list">
        {visiblePlans.length === 0 ? (
          <p className="my-plan-tier-empty">Chưa có gói thanh toán</p>
        ) : (
          visiblePlans.map((plan) => {
            const billing = resolveInventoryBillingMode(plan);
            const label = BILLING_PACKAGE_LABELS[billing] ?? billing;
            const { hoursRemaining, validUntil } = resolveLineHours(plan);

            return (
              <div
                key={plan.id}
                className={`my-plan-tier-line${plan.isActive ? ' is-active-line' : ''}`}
                role="listitem"
              >
                <span className="my-plan-tier-package">{label}</span>
                <span className="my-plan-tier-sep">:</span>
                <span className="my-plan-tier-remaining">
                  {formatPackageRemainingLine(hoursRemaining, validUntil)}
                </span>
                {canRenew(plan) && (
                  <button
                    type="button"
                    className="my-plan-tier-renew"
                    disabled={actionBusy}
                    onClick={() => {
                      if (billing !== 'combo1' && billing !== 'combo2') return;
                      onRenew({
                        planName: plan.planName,
                        billing,
                        subscriptionId: plan.subscriptionId,
                      });
                    }}
                  >
                    Tái tục
                    {getRenewPrice(plan) > 0 ? ` · ${formatCurrency(getRenewPrice(plan))}` : ''}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <button
        type="button"
        className="my-plan-tier-buy"
        onClick={onOpenPurchase}
      >
        Mua {tierName}
      </button>
    </article>
  );
}

export default function MyPlanPanel({
  accessToken,
  subscription: subscriptionProp,
  billingView: billingViewProp,
  onBillingRefresh,
}: MyPlanPanelProps) {
  const router = useRouter();
  useGpuPricingConfig();
  const [plansData, setPlansData] = useState<PlansResponse | null>(null);
  const [hasUsedTrial, setHasUsedTrial] = useState(false);
  const [meSubscription, setMeSubscription] = useState<DashboardSubscription | null>(null);
  const [meBillingView, setMeBillingView] = useState<BillingSessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [renewTarget, setRenewTarget] = useState<RenewTarget | null>(null);
  const [purchaseTarget, setPurchaseTarget] = useState<(typeof PLAN_ORDER)[number] | null>(null);
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
      setToast('Đã chọn gói dịch vụ.');
      notifyUserPlansChanged();
      await onBillingRefresh?.({ silent: true });
      await loadPlans();
    } catch {
      setToast('Lỗi mạng khi đổi gói.');
    } finally {
      setActionBusy(false);
    }
  };

  const subscription = subscriptionProp ?? meSubscription;
  const billingView = billingViewProp ?? meBillingView;
  const activePlan = plansData?.activePlan ?? null;
  const allItems = plansData?.items ?? [];

  const machineSessionActive =
    billingView?.phase === 'running' ||
    billingView?.phase === 'opening' ||
    billingView?.phase === 'stopping' ||
    billingView?.phase === 'disconnected';

  const groupedByTier = useMemo(() => groupInventoryPlansByTier(allItems), [allItems]);
  const activeTierKey = useMemo(
    () => resolveActiveTierKey(groupedByTier, activePlan),
    [groupedByTier, activePlan],
  );
  const activePlanHoursOverlay =
    activePlan != null
      ? resolveActivePlanHoursOverlay(activePlan, subscription, billingView)
      : undefined;

  const getRenewPrice = useCallback((plan: InventoryPlan) => {
    if (!canRenew(plan)) return 0;
    const billing = resolveInventoryBillingMode(plan);
    if (billing !== 'combo1' && billing !== 'combo2' && billing !== 'hourly') return 0;
    return getPlanPrice(plan.planName, billing);
  }, []);

  const handleSelectPurchase = (
    tierKey: (typeof PLAN_ORDER)[number],
    billing: BillingMode,
    hourlyHours?: number,
  ) => {
    const tierName = getPlanNameFromKey(tierKey) ?? tierKey;
    setPurchaseTarget(null);
    void router.push(buildBangGiaCheckoutUrl(tierName, billing, hourlyHours, { additional: true }));
  };

  const handleSelectTier = async (tierKey: (typeof PLAN_ORDER)[number]) => {
    if (machineSessionActive) {
      setToast('Vui lòng tắt máy trước khi đổi gói dịch vụ.');
      return;
    }
    const target = pickTierActivationTarget(groupedByTier[tierKey]);
    if (!target) {
      setToast('Chưa có gói khả dụng cho mức này.');
      return;
    }
    if (target.isActive) return;
    const plan = groupedByTier[tierKey].find((row) => row.id === target.id);
    if (!plan?.id) return;
    await handleActivate(plan.id);
  };

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

  const hasAnyUsablePlan = allItems.some((item) => item.usable);

  return (
    <div className="my-plan-panel">
      <PlanHero />

      {machineSessionActive && (
        <div className="my-plan-session-lock-note" style={{ padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--text-muted)', background: 'var(--bg-elevated, rgba(255,255,255,0.04))', borderRadius: 8 }}>
          🔒 Phiên làm việc đang mở — cần <strong>tắt máy</strong> trước khi đổi Gói dịch vụ (vì mỗi gói dùng loại GPU khác nhau).
        </div>
      )}

      {!hasAnyUsablePlan && (
        <div className="card my-plan-welcome my-plan-welcome-compact">
          <p className="my-plan-welcome-text">
            Bạn chưa có gói GPU nào. Chọn gói dịch vụ bên dưới hoặc mua thêm để bắt đầu.
          </p>
          {!hasUsedTrial && (
            <Link href={`${routes.register}?trial=true`} className="my-plan-trial-link">
              Dùng thử miễn phí 3 giờ
            </Link>
          )}
        </div>
      )}

      <div className="my-plan-tier-grid">
        {PLAN_ORDER.map((tierKey) => (
          <ServiceTierCard
            key={tierKey}
            tierKey={tierKey}
            plans={groupedByTier[tierKey]}
            isSelected={activeTierKey === tierKey}
            activePlanId={activePlan?.id ?? null}
            hoursOverlay={activeTierKey === tierKey ? activePlanHoursOverlay : undefined}
            subscription={subscription}
            billingView={billingView}
            actionBusy={actionBusy}
            machineSessionActive={machineSessionActive}
            onSelectTier={handleSelectTier}
            onRenew={setRenewTarget}
            getRenewPrice={getRenewPrice}
            onOpenPurchase={() => setPurchaseTarget(tierKey)}
          />
        ))}
      </div>

      <StorageUpgradeCard className="my-plan-storage-upgrade" />

      {purchaseTarget && (
        <PlanPurchaseModal
          open={Boolean(purchaseTarget)}
          tierKey={purchaseTarget}
          onClose={() => setPurchaseTarget(null)}
          onConfirm={(billing, hourlyHours) =>
            handleSelectPurchase(purchaseTarget, billing, hourlyHours)
          }
        />
      )}

      {renewTarget && accessToken && (
        <RenewPlanModal
          open={Boolean(renewTarget)}
          accessToken={accessToken}
          planName={renewTarget.planName}
          billing={renewTarget.billing}
          subscriptionId={renewTarget.subscriptionId}
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
