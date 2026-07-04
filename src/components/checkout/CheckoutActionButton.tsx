import { useRouter } from 'next/router';
import { useCheckoutSession } from '@/hooks/useCheckoutSession';
import { useActivePlanGate } from '@/hooks/useActivePlanGate';
import { buildLoginRedirectUrl } from '@/lib/checkout-auth';
import { styles } from '@/styles/components/checkout-action.styles';

export type CheckoutActionButtonProps = {
  /** URL quay lại sau khi đăng nhập (kèm query giữ lựa chọn) */
  continueUrl: string;
  /** URL bước thanh toán khi đã đăng nhập */
  paymentUrl: string;
  /** Gọi thay vì navigate — dùng khi đã ở trang checkout-plan */
  onProceedToPayment?: () => void;
  disabled?: boolean;
  size?: 'default' | 'compact';
  className?: string;
};

export default function CheckoutActionButton({
  continueUrl,
  paymentUrl,
  onProceedToPayment,
  disabled = false,
  size = 'default',
  className = '',
}: CheckoutActionButtonProps) {
  const router = useRouter();
  const { isLoggedIn, loading } = useCheckoutSession();
  const { redirectIfActivePlan } = useActivePlanGate();

  const wrapClass = [
    'checkout-action-wrap',
    size === 'compact' ? 'checkout-action-wrap--compact' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const btnClass = [
    'checkout-action-btn',
    isLoggedIn ? 'checkout-action-btn--pay' : 'checkout-action-btn--login',
    size === 'compact' ? 'checkout-action-btn--compact' : '',
  ].join(' ');

  if (loading) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
        <div className={wrapClass}>
          <span className="checkout-action-loading">Đang kiểm tra phiên đăng nhập...</span>
        </div>
      </>
    );
  }

  const handleClick = async () => {
    if (disabled) return;

    if (isLoggedIn) {
      if (await redirectIfActivePlan()) return;

      if (onProceedToPayment) {
        onProceedToPayment();
        return;
      }
      router.push(paymentUrl);
      return;
    }

    router.push(buildLoginRedirectUrl(continueUrl));
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className={wrapClass}>
        <button type="button" className={btnClass} onClick={handleClick} disabled={disabled}>
          {isLoggedIn ? '💳 Thanh toán ngay' : '🔐 Đăng nhập để tiếp tục'}
        </button>
      </div>
    </>
  );
}
