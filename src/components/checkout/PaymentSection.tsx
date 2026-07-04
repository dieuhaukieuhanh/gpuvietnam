import { useRouter } from 'next/router';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useGpuPricingConfig } from '@/hooks/useGpuPricingConfig';
import {
  BILLING_CONFIRM_LABELS,
  BILLING_LABELS,
  findCheckoutPlan,
} from '@/lib/checkout-plans';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { routes } from '@/lib/routes';
import type { CheckoutOrder } from '@/lib/checkout-order';

type PaymentSectionProps = {
  order: CheckoutOrder;
};

export default function PaymentSection({ order }: PaymentSectionProps) {
  const router = useRouter();
  const { refreshSession } = useAuth();
  const { plans } = useGpuPricingConfig();
  const [paymentChecked, setPaymentChecked] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const plan = findCheckoutPlan(order.plan, plans);
  const pricing = plan.pricing[order.billing];
  const phone = order.phone ?? '09xxxxxxx';
  const transferContent = `${phone} + Gói ${order.plan} + ${BILLING_LABELS[order.billing]}`;

  const copyTransferContent = () => {
    navigator.clipboard.writeText(transferContent).then(() => {
      setCopySuccess(true);
      window.setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const submitPayment = async () => {
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
          transferNote: transferContent,
        }),
      });

      let result: { error?: string; message?: string; code?: string } = {};
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

      setShowConfirmModal(false);
      setPaymentChecked(false);
      router.push(`${routes.dashboard}?pending=1`);
    } catch {
      setSubmitError('Không kết nối được máy chủ. Kiểm tra npm run dev đang chạy.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="payment-section" id="paymentSection">
        <h3>💳 Thanh Toán Chuyển Khoản</h3>
        <p className="subtitle">Quét mã QR bên dưới để thanh toán</p>

        {submitError && <div className="error-msg">{submitError}</div>}

        <div className="qr-placeholder">
          🖼️ Chèn ảnh QR
          <br />
          tại đây
        </div>

        <div className="transfer-info">
          <strong>Nội dung chuyển khoản:</strong>
          <br />
          <span className="highlight">{transferContent}</span>
        </div>

        <button type="button" className="copy-btn" onClick={copyTransferContent}>
          {copySuccess ? '✅ Đã sao chép!' : '📋 Sao chép nội dung CK'}
        </button>

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
          className={`btn btn-primary btn-lg${paymentChecked && !submitting ? '' : ' btn-disabled'}`}
          onClick={() => setShowConfirmModal(true)}
          style={{ marginTop: '16px', width: '100%' }}
          disabled={!paymentChecked || submitting}
        >
          {submitting ? 'Đang ghi nhận...' : '✅ Tôi đã thanh toán'}
        </button>
      </div>

      <div
        className={`modal-overlay${showConfirmModal ? ' active' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowConfirmModal(false);
        }}
      >
        <div className="modal-box">
          <h3>⚠️ Xác nhận thanh toán</h3>
          <div className="info-box">
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
            <div>
              🖥️ <strong>Môi trường:</strong> {order.env}
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Yêu cầu sẽ được ghi nhận và <strong>chờ Admin xác nhận</strong> chuyển khoản thật
            trước khi kích hoạt GPU (5–10 phút).
          </p>
          <div className="btn-group">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowConfirmModal(false)}
              disabled={submitting}
            >
              ❌ Hủy
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={submitPayment}
              disabled={submitting}
            >
              {submitting ? 'Đang xử lý...' : '✅ Gửi yêu cầu xác nhận'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
