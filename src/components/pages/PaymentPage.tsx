import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import PublicHeader from '@/components/layout/PublicHeader';
import { useGpuPricingConfig } from '@/hooks/useGpuPricingConfig';
import {
  BILLING_CONFIRM_LABELS,
  BILLING_LABELS,
  findCheckoutPlan,
} from '@/lib/checkout-plans';
import { parseCheckoutOrder } from '@/lib/checkout-order';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/checkout-flow.styles';

export default function PaymentPage() {
  const router = useRouter();
  const { plans } = useGpuPricingConfig();
  const [paymentChecked, setPaymentChecked] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const order = router.isReady ? parseCheckoutOrder(router.query) : null;
  const plan = order ? findCheckoutPlan(order.plan, plans) : null;

  useEffect(() => {
    if (!router.isReady) return;
    if (!parseCheckoutOrder(router.query)?.email) {
      router.replace(routes.checkoutPlan);
    }
  }, [router]);

  useEffect(() => {
    if (!showConfirmModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowConfirmModal(false);
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showConfirmModal]);

  if (!router.isReady || !order || !plan || !order.phone || !order.email) {
    return null;
  }

  const pricing = plan.pricing[order.billing];
  const transferContent = `${order.phone} + Gói ${order.plan} + ${BILLING_LABELS[order.billing]}`;

  const copyTransferContent = () => {
    navigator.clipboard.writeText(transferContent).then(() => {
      setCopySuccess(true);
      window.setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const submitPayment = async () => {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer re_xxxxxxxx',
        },
        body: JSON.stringify({
          from: 'GPUVietnam <notify@gpuvietnam.com>',
          to: 'your-email@gmail.com',
          subject: `🔔 KH mới: Gói ${order.plan} - ${BILLING_LABELS[order.billing]}`,
          html: `
            <h2>Có khách hàng xác nhận thanh toán!</h2>
            <p><strong>Email:</strong> ${order.email}</p>
            <p><strong>SĐT:</strong> ${order.phone}</p>
            <p><strong>Gói:</strong> ${order.plan}</p>
            <p><strong>Cách dùng:</strong> ${BILLING_LABELS[order.billing]}</p>
            <p><strong>Số tiền:</strong> ${pricing.price}${pricing.unit}</p>
            <p><strong>Môi trường:</strong> ${order.env}</p>
            <p><strong>Thời gian:</strong> ${new Date().toLocaleString('vi-VN')}</p>
          `,
        }),
      });
    } catch {
      // Email notification is optional
    }

    setShowConfirmModal(false);
    setPaymentChecked(false);

    alert(
      '✅ Cảm ơn bạn!\n\nChúng tôi sẽ kiểm tra thanh toán, gửi mật khẩu qua email và OTP xác thực SĐT trong vòng 5-10 phút.\n\nNếu cần hỗ trợ gấp, vui lòng nhắn Zalo: 09xxxxxxx',
    );
  };

  return (
    <>
      <Head>
        <title>GPUVietnam – Thanh toán</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>

      <PublicHeader showNav={false} />

      <main className="main-content">
        <div className="container">
          <h2 className="section-title">Thanh toán</h2>
          <p className="section-subtitle">Quét mã QR và chuyển khoản để hoàn tất đăng ký</p>

          <div className="steps">
            <span className="step-item done">1. Chọn gói</span>
            <span className="step-item done">2. Đăng ký</span>
            <span className="step-item active">3. Thanh toán</span>
          </div>

          <div className="order-summary">
            <h4>📦 Thông tin đơn hàng</h4>
            <div className="order-row">
              <strong>Email</strong>
              <span>{order.email}</span>
            </div>
            <div className="order-row">
              <strong>SĐT</strong>
              <span>{order.phone}</span>
            </div>
            <div className="order-row">
              <strong>Gói</strong>
              <span>
                {order.plan} — {pricing.price}
                {pricing.unit}
              </span>
            </div>
            <div className="order-row">
              <strong>Cách dùng</strong>
              <span>{BILLING_CONFIRM_LABELS[order.billing]}</span>
            </div>
            <div className="order-row">
              <strong>Môi trường</strong>
              <span>{order.env}</span>
            </div>
          </div>

          <div className="payment-section">
            <h3>💳 Thanh Toán Chuyển Khoản</h3>
            <p className="subtitle">Quét mã QR bên dưới để thanh toán</p>

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
              className={`btn btn-primary${paymentChecked ? '' : ' btn-disabled'}`}
              onClick={() => setShowConfirmModal(true)}
              style={{ marginTop: '16px' }}
              disabled={!paymentChecked}
            >
              ✅ Tôi đã thanh toán
            </button>

            <p style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
              💡 Sau khi xác nhận, chúng tôi kiểm tra thanh toán và gửi mật khẩu + OTP qua email/SĐT
              trong 5-10 phút.
            </p>
          </div>
        </div>
      </main>

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
              📧 <strong>Email:</strong> {order.email}
            </div>
            <div>
              📱 <strong>SĐT:</strong> {order.phone}
            </div>
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
          <div className="btn-group">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowConfirmModal(false)}
            >
              ❌ Hủy
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={submitPayment}>
              ✅ Xác nhận
            </button>
          </div>
        </div>
      </div>

      <footer className="footer">
        <div className="container">
          <p className="copyright">© 2026 GPUVietnam. Tất cả quyền được bảo lưu.</p>
        </div>
      </footer>
    </>
  );
}
