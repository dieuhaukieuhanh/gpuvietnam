import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import CheckoutActionButton from '@/components/checkout/CheckoutActionButton';
import PublicHeader from '@/components/layout/PublicHeader';
import { useActivePlanGate } from '@/hooks/useActivePlanGate';
import { useGpuPricingConfig } from '@/hooks/useGpuPricingConfig';
import { buildCheckoutPlanPaymentUrl } from '@/lib/checkout-auth';
import { findCheckoutPlan, type BillingMode } from '@/lib/checkout-plans';
import { orderToSearchParams } from '@/lib/checkout-order';
import { routes } from '@/lib/routes';
import { WORKSTATIONS, type Workstation } from '@/lib/workstations';
import { styles } from '@/styles/pages/checkout-2.styles';

function contactCustomWorkstation() {
  alert(
    '🎯 Workstation Theo Yêu Cầu\n\n📱 Nhắn Zalo: 0961 862 141 mô tả nhu cầu của bạn.\nChúng tôi sẽ tạo môi trường riêng trong 24h — miễn phí setup.',
  );
}

export default function Checkout2Page() {
  const router = useRouter();
  const { hasActivePlan, loaded: planGateLoaded, goToDashboard } = useActivePlanGate();
  const { plans } = useGpuPricingConfig();
  const [selectedEnvName, setSelectedEnvName] = useState<string | null>(null);

  const planName = (router.query.plan as string) || 'Pro';
  const billing = ((router.query.billing as string) || 'combo1') as BillingMode;
  const plan = findCheckoutPlan(planName, plans);
  const pricing = plan.pricing[billing] ?? plan.pricing.combo1;

  const selectedWorkstation = WORKSTATIONS.find((w) => w.name === selectedEnvName) ?? null;
  const isCustomEnv = selectedWorkstation?.id === 6;

  const orderParams = useMemo(() => {
    if (!selectedWorkstation) return null;
    return {
      plan: plan.name,
      billing,
      env: selectedWorkstation.name,
      icon: selectedWorkstation.icon,
      desc: selectedWorkstation.desc,
    };
  }, [selectedWorkstation, plan.name, billing]);

  const continueUrl = useMemo(() => {
    if (!orderParams) {
      const base = orderToSearchParams({ plan: plan.name, billing });
      return `${routes.checkout2}?${base.toString()}`;
    }
    return `${routes.checkout2}?${orderToSearchParams(orderParams).toString()}`;
  }, [orderParams, plan.name, billing]);

  const paymentUrl = orderParams ? buildCheckoutPlanPaymentUrl(orderParams) : '';

  useEffect(() => {
    if (planGateLoaded && hasActivePlan) {
      goToDashboard();
    }
  }, [planGateLoaded, hasActivePlan, goToDashboard]);

  useEffect(() => {
    if (!router.isReady) return;

    const envFromQuery = router.query.env as string | undefined;
    if (envFromQuery && WORKSTATIONS.some((w) => w.name === envFromQuery)) {
      setSelectedEnvName(envFromQuery);
    }
  }, [router.isReady, router.query.env]);

  const toggleEnvironment = useCallback((workstation: Workstation) => {
    if (workstation.id === 6) {
      contactCustomWorkstation();
      return;
    }
    setSelectedEnvName((current) => (current === workstation.name ? null : workstation.name));
  }, []);

  return (
    <>
      <Head>
        <title>GPUVietnam – Chọn môi trường</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>

      <PublicHeader showNav={false} />

      <main className="main-content">
        <div className="container">
          <h2 className="section-title">Hoàn tất đăng ký</h2>
          <p className="section-subtitle">Bạn đã chọn gói. Giờ hãy chọn môi trường làm việc.</p>

          <div className="steps">
            <span className="step-item done">1. Chọn gói</span>
            <span className="step-item active">2. Chọn môi trường</span>
            <span className="step-item">3. Thanh toán</span>
            <span className="step-item">4. Kích hoạt</span>
          </div>

          <div className="selected-plan-card">
            <div className="plan-title-row">
              <div className="plan-icon">{plan.icon}</div>
              <div className="plan-name">{plan.name}</div>
            </div>
            <div className="plan-price">
              {pricing.price}
              <span>{pricing.unit}</span>
            </div>
            <div className="plan-note">{pricing.note}</div>
            <Link href={`${routes.home}#pricing`} className="change-plan">
              Đổi gói khác
            </Link>
          </div>

          <h3 className="env-selection-title">🖥️ Chọn môi trường làm việc</h3>
          <p className="env-selection-hint">Nhấn để chọn — nhấn lại để bỏ chọn</p>

          <div className="env-grid">
            {WORKSTATIONS.map((workstation) => (
              <button
                key={workstation.id}
                type="button"
                className={`env-option${selectedEnvName === workstation.name ? ' selected' : ''}${
                  workstation.id === 6 ? ' env-option-custom' : ''
                }`}
                onClick={() => toggleEnvironment(workstation)}
              >
                <div className="env-radio" aria-hidden="true" />
                <div className="env-emoji">{workstation.icon}</div>
                <div className="env-info">
                  <h4>{workstation.name}</h4>
                  <p>{workstation.desc}</p>
                </div>
              </button>
            ))}
          </div>

          {selectedEnvName && !isCustomEnv && (
            <p className="env-selected-note">
              ✅ Đã chọn: <strong>{selectedEnvName}</strong>
            </p>
          )}

          <div className="register-cta-section">
            <CheckoutActionButton
              continueUrl={continueUrl}
              paymentUrl={paymentUrl}
              disabled={!selectedWorkstation || isCustomEnv}
            />
            {!selectedWorkstation && (
              <p className="register-cta-note">⚠️ Vui lòng chọn một môi trường trước khi tiếp tục.</p>
            )}
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="container">
          <p className="copyright">
            © 2026 GPUVietnam. Tất cả quyền được bảo lưu. | hello@gpuvietnam.com | Zalo: 09xxxxxxx
          </p>
        </div>
      </footer>
    </>
  );
}
