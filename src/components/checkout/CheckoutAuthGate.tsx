import PaymentSection from '@/components/checkout/PaymentSection';
import CheckoutActionButton from '@/components/checkout/CheckoutActionButton';
import { useCheckoutSession } from '@/hooks/useCheckoutSession';
import { buildCheckoutPlanPaymentUrl } from '@/lib/checkout-auth';
import type { CheckoutOrder } from '@/lib/checkout-order';
import { orderToSearchParams } from '@/lib/checkout-order';
import { routes } from '@/lib/routes';

type CheckoutAuthGateProps = {
  order: CheckoutOrder | null;
  activePlan: string | null;
  onProceedToPayment?: () => void;
};

export default function CheckoutAuthGate({
  order,
  activePlan,
  onProceedToPayment,
}: CheckoutAuthGateProps) {
  const { user, loading, isLoggedIn } = useCheckoutSession();

  const userPhone =
    (user?.user_metadata?.phone as string | undefined) ?? order?.phone ?? undefined;

  if (!activePlan || !order) {
    return (
      <p className="checkout-auth-hint">
        👆 Vui lòng chọn một gói ở trên để tiếp tục thanh toán.
      </p>
    );
  }

  const continueUrl = `${routes.checkoutPlan}?${orderToSearchParams(order).toString()}`;
  const paymentUrl = buildCheckoutPlanPaymentUrl(order);

  if (loading) {
    return <p className="checkout-auth-hint">Đang kiểm tra phiên đăng nhập...</p>;
  }

  if (!isLoggedIn) {
    return (
      <div className="checkout-auth-section">
        <h3 className="checkout-auth-title">Thanh toán gói {activePlan}</h3>
        <p className="checkout-auth-subtitle">
          Bạn đã chọn gói <strong>{activePlan}</strong>. Đăng nhập để tiếp tục thanh toán — các
          lựa chọn sẽ được giữ nguyên.
        </p>
        <CheckoutActionButton continueUrl={continueUrl} paymentUrl={paymentUrl} />
      </div>
    );
  }

  return (
    <div className="checkout-auth-section">
      <div className="user-badge">
        <span>
          ✅ Đã đăng nhập: <strong>{user?.email}</strong>
        </span>
      </div>
      <CheckoutActionButton
        continueUrl={continueUrl}
        paymentUrl={paymentUrl}
        onProceedToPayment={onProceedToPayment}
      />
      <div style={{ marginTop: 24 }}>
        <PaymentSection
          order={{ ...order, email: user?.email ?? order.email, phone: userPhone }}
        />
      </div>
    </div>
  );
}
