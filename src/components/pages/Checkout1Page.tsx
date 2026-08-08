import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CheckoutAuthGate from '@/components/checkout/CheckoutAuthGate';
import PublicHeader from '@/components/layout/PublicHeader';
import BillingToggleBar from '@/components/pricing/BillingToggleBar';
import { useActivePlanGate } from '@/hooks/useActivePlanGate';
import { useGpuPricingConfig } from '@/hooks/useGpuPricingConfig';
import {
  resolveCheckoutPlans,
  type BillingMode,
  type Plan,
} from '@/lib/checkout-plans';
import { parseCheckoutOrder } from '@/lib/checkout-order';
import { WORKSTATIONS, type Workstation } from '@/lib/workstations';
import { styles } from '@/styles/pages/checkout-1.styles';

const DEFAULT_ENV = {
  name: 'ComfyUI — Character & Art',
  icon: '👤',
  desc: 'Nhân vật nhất quán 100% — IP-Adapter + ControlNet cài sẵn.',
};

const SELECTABLE_ENVIRONMENTS = WORKSTATIONS.filter((w) => w.id !== 6);

type SelectedEnv = {
  name: string;
  icon: string;
  desc: string;
};

function planButtonClass(plan: Plan): string {
  if (plan.featured) return 'btn btn-primary btn-full plan-cta';
  if (plan.planKey === 'studio' || plan.name === 'Studio' || plan.name === 'AI Studio') {
    return 'btn btn-outline-purple btn-full plan-cta';
  }
  return 'btn btn-secondary btn-full plan-cta';
}

function planCardClass(plan: Plan, activePlan: string | null): string {
  const classes = ['plan-card'];
  if (plan.featured) classes.push('featured');
  if (activePlan) {
    classes.push(plan.name === activePlan ? 'highlighted' : 'dimmed');
  }
  return classes.join(' ');
}

export default function Checkout1Page() {
  const router = useRouter();
  const authSectionRef = useRef<HTMLDivElement>(null);
  const { hasActivePlan, loaded: planGateLoaded, goToDashboard } = useActivePlanGate();
  const { plans, billingToggles } = useGpuPricingConfig();
  const displayPlans = resolveCheckoutPlans(plans);

  const [selectedEnv, setSelectedEnv] = useState<SelectedEnv>(DEFAULT_ENV);
  const [currentBilling, setCurrentBilling] = useState<BillingMode>('hourly');
  const [activePlan, setActivePlan] = useState<string | null>(null);
  const [showEnvModal, setShowEnvModal] = useState(false);

  const checkoutOrder = useMemo(() => {
    if (!activePlan) return null;
    return {
      plan: activePlan,
      billing: currentBilling,
      env: selectedEnv.name,
      icon: selectedEnv.icon,
      desc: selectedEnv.desc,
    };
  }, [activePlan, currentBilling, selectedEnv]);

  const { icon: envIcon, desc: envDesc } = selectedEnv;
  const envName = selectedEnv.name;

  const switchBilling = useCallback((mode: BillingMode) => {
    setCurrentBilling(mode);
  }, []);

  const selectPlan = useCallback(
    (planName: string) => {
      if (activePlan === planName) {
        setActivePlan(null);
        return;
      }

      setActivePlan(planName);
      window.setTimeout(() => {
        authSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    },
    [activePlan],
  );

  const selectEnvironment = useCallback((workstation: Workstation) => {
    setSelectedEnv({
      name: workstation.name,
      icon: workstation.icon,
      desc: workstation.desc,
    });
    setShowEnvModal(false);
  }, []);

  useEffect(() => {
    if (planGateLoaded && hasActivePlan) {
      goToDashboard();
    }
  }, [planGateLoaded, hasActivePlan, goToDashboard]);

  useEffect(() => {
    if (!router.isReady) return;

    setSelectedEnv({
      name: (router.query.env as string) || DEFAULT_ENV.name,
      icon: (router.query.icon as string) || DEFAULT_ENV.icon,
      desc: (router.query.desc as string) || DEFAULT_ENV.desc,
    });
  }, [router.isReady, router.query.env, router.query.icon, router.query.desc]);

  useEffect(() => {
    const preselectedPlan = router.query.plan as string | undefined;
    if (!preselectedPlan) return;
    setActivePlan(preselectedPlan);
  }, [router.query.plan]);

  useEffect(() => {
    if (!router.isReady) return;
    const order = parseCheckoutOrder(router.query);
    if (order?.billing) setCurrentBilling(order.billing);
  }, [router.isReady, router.query.billing]); // eslint-disable-line react-hooks/exhaustive-deps -- billing slice only; full router.query would over-trigger

  const scrollToPayment = useCallback(() => {
    authSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    if (!router.asPath.includes('#payment')) return;
    const preselectedPlan = router.query.plan as string | undefined;
    if (preselectedPlan) setActivePlan(preselectedPlan);
    window.setTimeout(scrollToPayment, 300);
  }, [router.isReady, router.asPath, router.query.plan, scrollToPayment]);

  useEffect(() => {
    if (!showEnvModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowEnvModal(false);
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showEnvModal]);

  return (
    <>
      <Head>
        <title>GPUVietnam – Đăng Ký Thuê GPU</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <>
        <PublicHeader showNav={false} />

        <main className="main-content">
          <div className="container">
            <div className="env-card" id="envCard">
              <div className="env-icon" id="envIcon">
                {envIcon}
              </div>
              <div className="env-info">
                <h3 id="envName">{envName}</h3>
                <p id="envDesc">{envDesc}</p>
              </div>
              <button
                type="button"
                className="env-change"
                onClick={() => setShowEnvModal(true)}
              >
                Đổi môi trường
              </button>
            </div>

            <h2 className="section-title">Chọn Gói Phù Hợp Với Bạn</h2>
            <p className="section-subtitle">
              Tất cả gói đều bao gồm máy chủ GPU riêng, môi trường cài sẵn, luôn có thể tùy
              chỉnh theo ý bạn
            </p>

            <div
              className={`selection-indicator${activePlan ? ' show' : ''}`}
              id="selectionIndicator"
            >
              ✅ Bạn đã chọn gói <strong id="selectedPlanLabel">{activePlan}</strong> — đăng
              ký / đăng nhập để thanh toán
            </div>

            <BillingToggleBar
              value={currentBilling}
              onChange={switchBilling}
              toggles={billingToggles}
            />

            <div className="pricing-grid" id="pricingGrid">
              {displayPlans.map((plan) => {
                const pricing = plan.pricing[currentBilling];

                return (
                  <div
                    key={plan.planKey ?? plan.name}
                    className={planCardClass(plan, activePlan)}
                    id={`plan-${plan.planKey ?? plan.name}`}
                  >
                    <div className="plan-card-head">
                      {plan.featured && <div className="badge">⭐ Phổ biến nhất</div>}
                      <div className="plan-title-row">
                        <div className="plan-icon">{plan.icon}</div>
                        <div className="plan-name">{plan.name}</div>
                      </div>
                      <div className="plan-tagline">{plan.tagline}</div>
                    </div>

                    <div className="plan-audience-block">
                      <p className="plan-label">Đối tượng phù hợp</p>
                      <div className="plan-audience-list">
                        {plan.bestForAudience.map((audience) => (
                          <div key={audience.label} className="plan-audience-item">
                            <span aria-hidden>{audience.icon}</span>
                            <span>{audience.label}</span>
                          </div>
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

                    <div className="plan-bestfor-block">
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

                    <div className="plan-features-block">
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
                        {plan.trustTitle || 'Tại sao yên tâm'}
                      </p>
                      <ul>
                        {plan.trust.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="plan-card-footer">
                      {plan.upgradeTitle ? (
                        <div className="plan-upgrade">
                          <p className="plan-label" style={{ marginBottom: '8px' }}>
                            {plan.upgradeTitle}
                          </p>
                          {plan.upgradeIntro ? (
                            <p
                              style={{
                                fontSize: '12px',
                                color: 'var(--text-secondary)',
                                marginBottom: '8px',
                              }}
                            >
                              {plan.upgradeIntro}
                            </p>
                          ) : null}
                          {plan.upgradeItems?.length ? (
                            <ul className="plan-list" style={{ marginBottom: '8px' }}>
                              {plan.upgradeItems.map((item) => (
                                <li key={item}>
                                  <span className="check-icon">•</span>
                                  {item}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {plan.upgradeFooter ? (
                            <p
                              style={{
                                fontSize: '12px',
                                color: 'var(--text-secondary)',
                                lineHeight: 1.5,
                              }}
                            >
                              {plan.upgradeFooter}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className={planButtonClass(plan)}
                        onClick={() => selectPlan(plan.name)}
                      >
                        {activePlan === plan.name ? 'Bỏ chọn' : plan.cta}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div ref={authSectionRef}>
              <CheckoutAuthGate
                order={checkoutOrder}
                activePlan={activePlan}
                onProceedToPayment={scrollToPayment}
              />
            </div>
          </div>
        </main>

        <div
          className={`modal-overlay${showEnvModal ? ' active' : ''}`}
          id="envModal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowEnvModal(false);
          }}
        >
          <div className="env-modal-box">
            <div className="env-modal-header">
              <div>
                <h3>🖥️ Chọn môi trường làm việc</h3>
                <p>Chọn môi trường phù hợp với nhu cầu của bạn</p>
              </div>
              <button
                type="button"
                className="env-modal-close"
                aria-label="Đóng"
                onClick={() => setShowEnvModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="env-picker-grid">
              {SELECTABLE_ENVIRONMENTS.map((workstation) => (
                <button
                  key={workstation.id}
                  type="button"
                  className={`env-picker-card${selectedEnv.name === workstation.name ? ' selected' : ''}`}
                  onClick={() => selectEnvironment(workstation)}
                >
                  <span className="env-picker-icon">{workstation.icon}</span>
                  <h4>{workstation.name}</h4>
                  <p>{workstation.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <footer className="footer">
          <div className="container">
            <p className="copyright">
              © 2026 GPUVietnam. Tất cả quyền được bảo lưu. | cskh@gpuvietnam.com | Zalo:
              09xxxxxxx
            </p>
          </div>
        </footer>
      </>
    </>
  );
}
