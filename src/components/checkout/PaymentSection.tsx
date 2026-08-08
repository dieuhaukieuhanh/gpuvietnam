import { useRouter } from 'next/router';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useGpuPricingConfig } from '@/hooks/useGpuPricingConfig';
import {
  BILLING_CONFIRM_LABELS,
  findCheckoutPlan,
} from '@/lib/checkout-plans';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { routes } from '@/lib/routes';
import type { CheckoutOrder } from '@/lib/checkout-order';

type PaymentSectionProps = {
  order: CheckoutOrder;
};

type PendingTransfer = {
  transferContent: string;
  transferCode: string;
  amount: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
  qrUrl?: string | null;
  expectedLabel?: string;
};

export default function PaymentSection({ order }: PaymentSectionProps) {
  const router = useRouter();
  const { refreshSession } = useAuth();
  const { plans } = useGpuPricingConfig();
  const [paymentChecked, setPaymentChecked] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);

  const plan = findCheckoutPlan(order.plan, plans);
  const pricing = plan.pricing[order.billing];

  const createTransferRequest = async () => {
    await refreshSession();
    const { data: sessionData } = await getSupabaseBrowser().auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setSubmitError('Phiên đăng nhập hết hạn. Vui lòng tải lại trang.');
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    try {
      const response = await fetch('/api/payment/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan: order.plan,
          billing: order.billing,
          env: order.env,
          icon: order.icon,
          desc: order.desc,
        }),
      });

      let result: {
        error?: string;
        transfer?: PendingTransfer & { amount?: number };
        transferCode?: string;
        amount?: number;
      } = {};
      try {
        result = await response.json();
      } catch {
        setSubmitError('Máy chủ phản hồi không hợp lệ. Hãy restart npm run dev và thử lại.');
        return;
      }

      if (!response.ok) {
        setSubmitError(result.error ?? 'Không ghi nhận được thanh toán.');
        return;
      }

      const transfer = result.transfer;
      if (transfer?.transferContent) {
        setPendingTransfer({
          transferContent: transfer.transferContent,
          transferCode: transfer.transferCode || result.transferCode || '',
          amount: Number(transfer.amount ?? result.amount ?? 0),
          bankName: transfer.bankName || 'MB Bank',
          accountNumber: transfer.accountNumber || '888666369',
          accountName: transfer.accountName || 'Lê Thế Cường',
          qrUrl: transfer.qrUrl || null,
          expectedLabel: transfer.expectedLabel || '~1–5 phút (tự động)',
        });
        return;
      }

      router.push(`${routes.dashboard}?pending=1`);
    } catch {
      setSubmitError('Không kết nối được máy chủ. Kiểm tra npm run dev đang chạy.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyTransferContent = () => {
    const text = pendingTransfer?.transferContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      window.setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  return (
    <div className="payment-section" id="paymentSection">
      <h3>💳 Thanh Toán Chuyển Khoản</h3>
      <p className="subtitle">
        Tạo yêu cầu để nhận QR + mã NV — chuyển khoản xong hệ thống tự kích hoạt gói.
      </p>

      {submitError && <div className="error-msg">{submitError}</div>}

      {!pendingTransfer ? (
        <>
          <div className="info-box" style={{ marginBottom: 12 }}>
            <div>
              📦 <strong>Gói:</strong> {order.plan}
            </div>
            <div>
              ⏱️ <strong>Cách dùng:</strong> {BILLING_CONFIRM_LABELS[order.billing]}
            </div>
            <div>
              💰 <strong>Số tiền:</strong> {pricing.price}
              {pricing.unit}
            </div>
          </div>
          <button
            type="button"
            className={`btn btn-primary btn-lg${!submitting ? '' : ' btn-disabled'}`}
            onClick={() => void createTransferRequest()}
            style={{ marginTop: '16px', width: '100%' }}
            disabled={submitting}
          >
            {submitting ? 'Đang tạo yêu cầu...' : 'Tạo yêu cầu chuyển khoản'}
          </button>
        </>
      ) : (
        <>
          <div className="qr-placeholder">
            {pendingTransfer.qrUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pendingTransfer.qrUrl} alt="QR chuyển khoản" width={220} height={220} />
            ) : (
              <>
                🖼️ QR thanh toán
                <br />
                tại đây
              </>
            )}
          </div>

          <div className="transfer-info">
            <div>
              <strong>Ngân hàng:</strong> {pendingTransfer.bankName}
            </div>
            <div>
              <strong>STK:</strong> {pendingTransfer.accountNumber}
            </div>
            <div>
              <strong>Chủ TK:</strong> {pendingTransfer.accountName}
            </div>
            {pendingTransfer.amount > 0 && (
              <div>
                <strong>Số tiền:</strong> {pendingTransfer.amount.toLocaleString('vi-VN')}đ
              </div>
            )}
            <br />
            <strong>Nội dung chuyển khoản:</strong>
            <br />
            <span className="highlight">{pendingTransfer.transferContent}</span>
          </div>

          <button type="button" className="copy-btn" onClick={copyTransferContent}>
            {copySuccess ? '✅ Đã sao chép!' : '📋 Sao chép nội dung CK'}
          </button>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
            ⏱️ {pendingTransfer.expectedLabel}. Không cần chờ Admin duyệt thủ công.
          </p>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={paymentChecked}
              onChange={(e) => setPaymentChecked(e.target.checked)}
            />
            <span>Tôi xác nhận đã chuyển khoản đúng nội dung bên trên</span>
          </label>

          <button
            type="button"
            className={`btn btn-primary btn-lg${paymentChecked ? '' : ' btn-disabled'}`}
            onClick={() => router.push(`${routes.dashboard}?pending=1`)}
            style={{ marginTop: '16px', width: '100%' }}
            disabled={!paymentChecked}
          >
            ✅ Đã chuyển — vào Dashboard
          </button>
        </>
      )}
    </div>
  );
}
