import { useRouter } from 'next/router';
import { useCallback, useState } from 'react';
import BillingToggleBar from '@/components/pricing/BillingToggleBar';
import { planButtonClass } from '@/components/pricing/pricing-section-shared';
import { useActivePlanGate } from '@/hooks/useActivePlanGate';
import { getStarterPlanCta, usePricingContext } from '@/hooks/usePricingContext';
import { useCheckoutSession } from '@/hooks/useCheckoutSession';
import { useGpuPricingConfig } from '@/hooks/useGpuPricingConfig';
import { buildBangGiaCheckoutUrl, buildLoginRedirectUrl } from '@/lib/checkout-auth';
import { CHECKOUT_PLANS, type BillingMode } from '@/lib/checkout-plans';
import { routes } from '@/lib/routes';

type HomePricingSectionProps = {
  id?: string;
  variant?: 'home' | 'standalone';
  onStarterTrial: () => void;
};

export default function HomePricingSection({
  id = 'pricing',
  variant = 'home',
  onStarterTrial,
}: HomePricingSectionProps) {
  const router = useRouter();
  const [currentBilling, setCurrentBilling] = useState<BillingMode>('hourly');
  const { plans, billingToggles, section, loading: loadingPricing } = useGpuPricingConfig();
  const displayPlans = plans.length > 0 ? plans : CHECKOUT_PLANS;
  const { isReturningCustomer, eligibleForTrial, loading: loadingContext } = usePricingContext();
  const { isLoggedIn, loading: loadingSession } = useCheckoutSession();
  const { redirectIfActivePlan } = useActivePlanGate();

  const handlePlanCTA = useCallback(
    async (planName: string) => {
      if (isLoggedIn && (await redirectIfActivePlan())) {
        return;
      }

      const starterTrialEligible = planName === 'Starter' && eligibleForTrial;

      if (starterTrialEligible) {
        onStarterTrial();
        return;
      }

      if (variant === 'standalone') {
        const checkoutUrl = buildBangGiaCheckoutUrl(planName, currentBilling);
        if (!isLoggedIn) {
          router.push(buildLoginRedirectUrl(checkoutUrl));
          return;
        }
        router.push(checkoutUrl);
        return;
      }

      const params = new URLSearchParams({
        plan: planName,
        billing: currentBilling,
      });
      router.push(`${routes.checkout2}?${params.toString()}`);
    },
    [currentBilling, eligibleForTrial, isLoggedIn, onStarterTrial, redirectIfActivePlan, router, variant],
  );

  const getPlanCtaLabel = (planName: string) => {
    if (planName === 'Starter') {
      return getStarterPlanCta(isReturningCustomer);
    }
    if (planName === 'Pro') return 'Chọn Pro';
    if (planName === 'Studio') return 'Chọn Studio';
    return 'Chọn gói';
  };

  return (
    <section className="section section-dark" id={id}>
      <div className="container">
        <h2 className="section-title">{section.title}</h2>
        <p className="section-subtitle">{section.subtitle}</p>
        <BillingToggleBar
          value={currentBilling}
          onChange={setCurrentBilling}
          toggles={billingToggles as { mode: BillingMode; label: string }[]}
        />
        <div className="pricing-grid" id="pricingGrid">
          {displayPlans.map((plan) => {
            const pricing = plan.pricing[currentBilling];
            const showFeaturedBadge = plan.featured && (plan.badge ?? 'Phổ biến nhất');

            return (
              <div
                key={plan.name}
                className={`plan-card${plan.featured ? ' featured' : ''}`}
                id={`plan-${plan.name}`}
              >
                {showFeaturedBadge ? (
                  <div className="badge">⭐ {plan.badge ?? 'Phổ biến nhất'}</div>
                ) : null}
                <div className="plan-icon">{plan.icon}</div>
                <div className="plan-name">{plan.name}</div>
                <div className="plan-tagline">{plan.tagline}</div>
                <div style={{ marginBottom: '20px' }}>
                  <p className="plan-label">Đối tượng phù hợp</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {plan.bestForAudience.map((audience) => (
                      <span
                        key={audience.label}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          background: 'rgba(79, 142, 247, 0.08)',
                          padding: '3px 10px',
                          borderRadius: '14px',
                          fontSize: '11px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {audience.icon} {audience.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="plan-price-row">
                  <div className="plan-price">
                    {pricing.price}
                    <span>{pricing.unit}</span>
                  </div>
                  <div className="plan-price-note">{pricing.note}</div>
                </div>
                <div>
                  <p className="plan-label">Phù hợp để làm</p>
                  <ul className="plan-list">
                    {plan.bestFor.map((item) => (
                      <li key={item}>
                        <span className="check-icon">✓</span>
                        {item}
                      </li>
                    ))}
                    {plan.notFor && (
                      <li className="excluded">
                        <span className="x-icon">✕</span>
                        {plan.notFor}
                      </li>
                    )}
                  </ul>
                </div>
                <div className="plan-real-output">
                  <strong>GPU:</strong> {plan.gpuLabel}
                </div>
                <div>
                  <p className="plan-label">Tính năng</p>
                  <ul className="plan-list">
                    {plan.features.map((feature) => (
                      <li key={feature.text} className={feature.included ? '' : 'excluded'}>
                        <span className={feature.included ? 'check-icon' : 'x-icon'}>
                          {feature.included ? '✓' : '✕'}
                        </span>
                        {feature.text}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="plan-trust">
                  <p className="plan-label" style={{ marginBottom: '8px' }}>
                    Tại sao yên tâm
                  </p>
                  <ul>
                    {plan.trust.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <button
                  type="button"
                  className={planButtonClass(plan)}
                  onClick={() => handlePlanCTA(plan.name)}
                  disabled={loadingContext || loadingSession || loadingPricing}
                >
                  {loadingContext && plan.name === 'Starter'
                    ? 'Đang tải...'
                    : getPlanCtaLabel(plan.name)}
                </button>
              </div>
            );
          })}
        </div>
        <div className="text-center mt-12 space-y-2">
          {eligibleForTrial && (
            <p style={{ fontSize: '13.5px', color: 'var(--text-muted)' }}>
              ✓ Trải nghiệm 3 giờ miễn phí – không cần thanh toán trước
            </p>
          )}
          <p style={{ fontSize: '13.5px', color: 'var(--text-muted)' }}>
            {section.footerPaymentNote}
            {variant === 'standalone' ? ' hoặc Ví nạp trước' : ''}
          </p>
        </div>
      </div>
    </section>
  );
}
