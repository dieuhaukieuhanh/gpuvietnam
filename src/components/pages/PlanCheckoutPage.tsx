import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import PublicHeader from '@/components/layout/PublicHeader';
import PublicFooter from '@/components/layout/PublicFooter';
import { useAuth } from '@/contexts/AuthContext';
import { useActivePlanGate } from '@/hooks/useActivePlanGate';
import { useGpuPricingConfig } from '@/hooks/useGpuPricingConfig';
import {
  BILLING_CONFIRM_LABELS,
  BILLING_LABELS,
  findCheckoutPlan,
  type BillingMode,
} from '@/lib/checkout-plans';
import { DEFAULT_CHECKOUT_ENV } from '@/lib/checkout-auth';
import {
  formatComboHoursBreakdown,
  getPlanPrice,
  getPlanPurchaseAmount,
  getPlanQuota,
  normalizeHourlyPurchaseHours,
} from '@/lib/gpu-pricing';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { routes } from '@/lib/routes';
import { notifyUserPlansChanged } from '@/hooks/useUserPlans';
import { styles as baseStyles } from '@/styles/pages/trang-chu.styles';
import { styles as checkoutStyles } from '@/styles/pages/checkout-flow.styles';
import { styles as planCheckoutStyles } from '@/styles/pages/plan-checkout.styles';

const VALID_BILLING: BillingMode[] = ['hourly', 'combo1', 'combo2'];

export default function PlanCheckoutPage() {
  const router = useRouter();
  const { user, session, loading: authLoading } = useAuth();
  const { hasActivePlan, loaded: planGateLoaded, goToDashboard } = useActivePlanGate();

  const { plans } = useGpuPricingConfig();

  const planName = (router.query.plan as string) || 'Pro';
  const billing = (
    VALID_BILLING.includes(router.query.billing as BillingMode)
      ? router.query.billing
      : 'combo1'
  ) as BillingMode;
  const hourlyHours =
    billing === 'hourly' ? normalizeHourlyPurchaseHours(router.query.hours) : null;
  const isAdditionalPurchase = router.query.additional === '1';

  const plan = findCheckoutPlan(planName, plans);
  const pricing = plan.pricing[billing];
  const amount = getPlanPurchaseAmount(planName, billing, hourlyHours);

  const [walletBalance, setWalletBalance] = useState(0);
  const [loadingWallet, setLoadingWallet] = useState(true);
  const [paymentMode, setPaymentMode] = useState<'wallet' | 'transfer'>('wallet');
  const [transferChecked, setTransferChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);

  const phone =
    (user?.user_metadata?.phone as string | undefined) ??
    (user?.phone as string | undefined) ??
    '09xxxxxxx';

  const transferContent = useMemo(
    () => `${phone} + Gói ${plan.name} + ${BILLING_LABELS[billing]}`,
    [phone, plan.name, billing],
  );

  const checkoutUrl = useMemo(() => {
    const params = new URLSearchParams({ plan: planName, billing });
    if (billing === 'hourly' && hourlyHours != null) {
      params.set('hours', String(hourlyHours));
    }
    if (isAdditionalPurchase) {
      params.set('additional', '1');
    }
    return `${routes.bangGiaCheckout}?${params.toString()}`;
  }, [planName, billing, hourlyHours, isAdditionalPurchase]);

  const loadWallet = useCallback(async () => {
    if (!session?.access_token) return;

    setLoadingWallet(true);
    try {
      const res = await fetch('/api/user/pricing-context', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setWalletBalance(Number(data.walletBalance ?? 0));
      }
    } finally {
      setLoadingWallet(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (!isAdditionalPurchase && planGateLoaded && hasActivePlan) {
      goToDashboard();
    }
  }, [isAdditionalPurchase, planGateLoaded, hasActivePlan, goToDashboard]);

  useEffect(() => {
    if (!router.isReady) return;
    if (authLoading) return;

    if (!user) {
      router.replace(`${routes.login}?redirect=${encodeURIComponent(checkoutUrl)}`);
      return;
    }

    loadWallet();
  }, [router.isReady, authLoading, user, checkoutUrl, loadWallet, router]);

  const canPayWallet = walletBalance >= amount;

  const purchaseBody = {
    plan: plan.name,
    billing,
    hours: billing === 'hourly' ? hourlyHours : undefined,
    env: DEFAULT_CHECKOUT_ENV.name,
    icon: DEFAULT_CHECKOUT_ENV.icon,
    desc: DEFAULT_CHECKOUT_ENV.desc,
    ...(isAdditionalPurchase ? { additional: true } : {}),
  };

  const comboBreakdown =
    billing === 'hourly'
      ? null
      : formatComboHoursBreakdown(planName, billing, { includeReward: false });

  const validityDays = getPlanQuota(planName, billing).validityDays;
  const validityLabel =
    validityDays != null ? `Hiệu lực ${validityDays} ngày` : 'Không giới hạn';

  const billingSummaryLabel =
    billing === 'hourly'
      ? `Giờ lẻ · ${hourlyHours}h`
      : comboBreakdown
        ? `${BILLING_LABELS[billing]} · ${comboBreakdown.line}`
        : BILLING_CONFIRM_LABELS[billing];

  const handlePayWallet = async () => {
    const { data: sessionData } = await getSupabaseBrowser().auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setError('Phiên đăng nhập hết hạn. Vui lòng tải lại trang.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/payment/pay-wallet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(purchaseBody),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Thanh toán ví thất bại.');
        return;
      }

      notifyUserPlansChanged();
      router.push(`${routes.dashboard}?paid=1`);
    } catch {
      setError('Lỗi mạng khi thanh toán.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayTransfer = async () => {
    if (!transferChecked) return;

    const { data: sessionData } = await getSupabaseBrowser().auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setError('Phiên đăng nhập hết hạn. Vui lòng tải lại trang.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/payment/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...purchaseBody,
          transferNote: transferContent,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Không ghi nhận được thanh toán.');
        return;
      }

      router.push(`${routes.dashboard}?pending=1`);
    } catch {
      setError('Lỗi mạng khi ghi nhận thanh toán.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyTransfer = () => {
    navigator.clipboard.writeText(transferContent).then(() => {
      setCopySuccess(true);
      window.setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  if (authLoading || !user) {
    return null;
  }

  return (
    <>
      <Head>
        <title>GPUVietnam – Thanh toán gói {plan.name}</title>
        <style
          dangerouslySetInnerHTML={{ __html: baseStyles + checkoutStyles + planCheckoutStyles }}
        />
      </Head>

      <PublicHeader activeHref={routes.bangGia} />

      <main className="plan-checkout-page">
        <div className="container">
          <Link
            href={isAdditionalPurchase ? routes.dashboardGoiCuaToi : routes.bangGia}
            className="plan-checkout-back"
          >
            ← {isAdditionalPurchase ? 'Quay lại Gói của tôi' : 'Quay lại Bảng giá'}
          </Link>

          <h1 className="plan-checkout-title">💳 Thanh toán gói {plan.name}</h1>
          <p className="plan-checkout-subtitle">
            Chọn phương thức thanh toán — môi trường làm việc chọn sau trên Dashboard
          </p>

          <div className="plan-checkout-summary">
            <h3>Chi tiết đơn dịch vụ</h3>
            <div className="plan-checkout-summary-row">
              <span>Loại dịch vụ</span>
              <strong>Gói {plan.name}</strong>
            </div>
            <div className="plan-checkout-summary-row">
              <span>Số giờ sử dụng</span>
              <strong>{billingSummaryLabel}</strong>
            </div>
            <div className="plan-checkout-summary-row">
              <span>Thời hạn</span>
              <strong>{validityLabel}</strong>
            </div>
            {billing === 'hourly' && (
              <div className="plan-checkout-summary-row">
                <span>Đơn giá</span>
                <strong>
                  {getPlanPrice(planName, 'hourly').toLocaleString('vi-VN')}đ/giờ
                </strong>
              </div>
            )}
            <div className="plan-checkout-summary-row">
              <span>GPU</span>
              <strong>{plan.gpuLabel}</strong>
            </div>
            <div className="plan-checkout-total">
              {billing === 'hourly'
                ? `${amount.toLocaleString('vi-VN')}đ`
                : `${pricing.price}${pricing.unit}`}
            </div>
          </div>

          {error && <div className="plan-checkout-error">{error}</div>}

          <div className="plan-checkout-methods">
            <button
              type="button"
              className={`plan-checkout-method${paymentMode === 'wallet' ? ' active' : ''}`}
              onClick={() => setPaymentMode('wallet')}
            >
              <span className="method-icon">👛</span>
              <span className="method-label">Ví nạp trước</span>
              <span className="method-meta">
                {loadingWallet
                  ? 'Đang tải số dư...'
                  : `Số dư: ${new Intl.NumberFormat('vi-VN').format(walletBalance)}đ`}
              </span>
            </button>
            <button
              type="button"
              className={`plan-checkout-method${paymentMode === 'transfer' ? ' active' : ''}`}
              onClick={() => setPaymentMode('transfer')}
            >
              <span className="method-icon">🏦</span>
              <span className="method-label">Chuyển khoản</span>
              <span className="method-meta">Chờ Admin duyệt 5–10 phút</span>
            </button>
          </div>

          {paymentMode === 'wallet' && (
            <div className="plan-checkout-panel">
              <p>
                Thanh toán ngay từ số dư Ví. Gói {plan.name} được kích hoạt tức thì sau khi trừ
                tiền.
              </p>
              {!canPayWallet && !loadingWallet && (
                <p className="plan-checkout-warn">
                  Số dư không đủ.{' '}
                  <Link href={routes.dashboardWallet}>Nạp thêm ví</Link> hoặc chọn Chuyển khoản.
                </p>
              )}
              <button
                type="button"
                className={`btn btn-primary btn-lg${canPayWallet && !submitting ? '' : ' btn-disabled'}`}
                style={{ width: '100%', marginTop: 12 }}
                disabled={submitting || loadingWallet || !canPayWallet}
                onClick={handlePayWallet}
              >
                {submitting
                  ? 'Đang xử lý...'
                  : `Thanh toán ${amount.toLocaleString('vi-VN')}đ từ Ví`}
              </button>
            </div>
          )}

          {paymentMode === 'transfer' && (
            <div className="plan-checkout-panel">
              <p className="subtitle">Quét mã QR hoặc chuyển khoản theo thông tin bên dưới</p>
              <div className="plan-checkout-qr">🖼️ QR thanh toán</div>
              <div className="plan-checkout-transfer-note">
                <strong>Nội dung chuyển khoản:</strong>
                <span className="highlight">{transferContent}</span>
              </div>
              <button type="button" className="copy-btn" onClick={copyTransfer}>
                {copySuccess ? '✅ Đã sao chép!' : '📋 Sao chép nội dung CK'}
              </button>
              <label className="plan-checkout-check">
                <input
                  type="checkbox"
                  checked={transferChecked}
                  onChange={(e) => setTransferChecked(e.target.checked)}
                />
                Tôi xác nhận đã chuyển khoản đúng nội dung
              </label>
              <button
                type="button"
                className={`btn btn-primary btn-lg${transferChecked && !submitting ? '' : ' btn-disabled'}`}
                style={{ width: '100%', marginTop: 12 }}
                disabled={submitting || !transferChecked}
                onClick={handlePayTransfer}
              >
                {submitting ? 'Đang ghi nhận...' : '✅ Tôi đã chuyển khoản'}
              </button>
            </div>
          )}

          <p className="plan-checkout-hint">
            💡 Sau thanh toán, vào Dashboard để chọn môi trường ComfyUI khi bạn sẵn sàng.
          </p>
        </div>
      </main>

      <PublicFooter />
    </>
  );
}
