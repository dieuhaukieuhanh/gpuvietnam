import { useCallback, useEffect, useState } from 'react';

import { BILLING_LABELS, type BillingMode } from '@/lib/checkout-plans';

import { getPlanNameFromKey } from '@/lib/gpu-pricing';

import { WALLET_BANK_INFO } from '@/lib/wallet-deposit';



type RenewQuote = {

  planName: string;

  billing: BillingMode;

  baseHours: number;

  comboBonus: number;

  renewBonus: number;

  totalHours: number;

  bonusLabel: string | null;

  price: number;

};



type RenewPreview = {

  walletBalance: number;

  balanceAfter?: number;

  shortage?: number;

  transferNote?: string;

  quote: RenewQuote;

};



type RenewPlanModalProps = {

  open: boolean;

  accessToken: string;

  planName: string;

  billing: BillingMode;

  subscriptionId?: string | null;

  onClose: () => void;

  onSuccess: () => void;

  onPendingSubmitted?: () => void;

};



function formatVnd(amount: number) {

  return `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;

}



export default function RenewPlanModal({

  open,

  accessToken,

  planName,

  billing,

  subscriptionId,

  onClose,

  onSuccess,

  onPendingSubmitted,

}: RenewPlanModalProps) {

  const [loading, setLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const [preview, setPreview] = useState<RenewPreview | null>(null);

  const [insufficient, setInsufficient] = useState(false);

  const [transferChecked, setTransferChecked] = useState(false);

  const [pendingSubmitted, setPendingSubmitted] = useState(false);

  const [error, setError] = useState('');

  const [copySuccess, setCopySuccess] = useState(false);



  const loadPreview = useCallback(async () => {

    if (!accessToken) return;

    setLoading(true);

    setError('');

    setPendingSubmitted(false);

    setTransferChecked(false);

    try {

      const res = await fetch('/api/payment/renew', {

        method: 'POST',

        headers: {

          Authorization: `Bearer ${accessToken}`,

          'Content-Type': 'application/json',

        },

        body: JSON.stringify({ plan: planName, billing, subscriptionId: subscriptionId ?? null, previewOnly: true }),

      });

      const data = await res.json();

      if (res.status === 402) {

        setInsufficient(true);

        setPreview({

          walletBalance: data.walletBalance ?? 0,

          shortage: data.shortage ?? 0,

          transferNote: data.transferNote,

          quote: data.quote,

        });

        return;

      }

      if (!res.ok) {

        setError(data.error ?? 'Không tải được báo giá tái tục.');

        return;

      }

      setInsufficient(false);

      setPreview({

        walletBalance: data.walletBalance ?? 0,

        balanceAfter: data.balanceAfter,

        quote: data.quote,

      });

    } catch {

      setError('Lỗi mạng khi tải báo giá.');

    } finally {

      setLoading(false);

    }

  }, [accessToken, planName, billing, subscriptionId]);



  useEffect(() => {

    if (open) void loadPreview();

  }, [open, loadPreview]);



  useEffect(() => {

    if (!open) return undefined;



    const handleKeyDown = (event: KeyboardEvent) => {

      if (event.key === 'Escape' && !submitting) onClose();

    };



    document.body.style.overflow = 'hidden';

    document.addEventListener('keydown', handleKeyDown);

    return () => {

      document.body.style.overflow = '';

      document.removeEventListener('keydown', handleKeyDown);

    };

  }, [open, onClose, submitting]);



  const handleConfirm = async () => {

    if (!accessToken || !preview) return;

    setSubmitting(true);

    setError('');

    try {

      const res = await fetch('/api/payment/renew', {

        method: 'POST',

        headers: {

          Authorization: `Bearer ${accessToken}`,

          'Content-Type': 'application/json',

        },

        body: JSON.stringify({ plan: planName, billing, subscriptionId: subscriptionId ?? null }),

      });

      const data = await res.json();

      if (res.status === 402) {

        setInsufficient(true);

        setPreview({

          walletBalance: data.walletBalance ?? 0,

          shortage: data.shortage ?? 0,

          transferNote: data.transferNote,

          quote: data.quote,

        });

        return;

      }

      if (!res.ok) {

        setError(data.error ?? 'Tái tục thất bại.');

        return;

      }

      onSuccess();

      onClose();

    } catch {

      setError('Lỗi mạng khi tái tục.');

    } finally {

      setSubmitting(false);

    }

  };



  const handleTransferAck = async () => {

    if (!transferChecked || !accessToken) return;

    setSubmitting(true);

    setError('');

    try {

      const res = await fetch('/api/payment/renew', {

        method: 'POST',

        headers: {

          Authorization: `Bearer ${accessToken}`,

          'Content-Type': 'application/json',

        },

        body: JSON.stringify({ plan: planName, billing, subscriptionId: subscriptionId ?? null, confirmTransfer: true }),

      });

      const data = await res.json();

      if (!res.ok) {

        setError(data.error ?? 'Không gửi được yêu cầu tái tục.');

        return;

      }

      setPendingSubmitted(true);

      onPendingSubmitted?.();

    } catch {

      setError('Lỗi mạng khi gửi yêu cầu.');

    } finally {

      setSubmitting(false);

    }

  };



  const copyTransferNote = async () => {

    if (!preview?.transferNote) return;

    try {

      await navigator.clipboard.writeText(preview.transferNote);

      setCopySuccess(true);

      window.setTimeout(() => setCopySuccess(false), 2000);

    } catch {

      /* ignore */

    }

  };



  if (!open) return null;



  const displayName = getPlanNameFromKey(planName) ?? planName;

  const billingLabel = BILLING_LABELS[billing] ?? billing;

  const quote = preview?.quote;



  return (

    <div className="renew-modal-overlay" onClick={onClose} role="presentation">

      <div

        className="renew-modal"

        onClick={(e) => e.stopPropagation()}

        role="dialog"

        aria-modal="true"

        aria-labelledby="renew-modal-title"

      >

        <h3 id="renew-modal-title">

          {pendingSubmitted

            ? 'Đã gửi yêu cầu tái tục'

            : insufficient

              ? `Tái tục gói ${displayName}`

              : 'Xác nhận tái tục'}

        </h3>



        {loading && <p className="renew-modal-muted">Đang tải báo giá...</p>}



        {error && <p className="renew-modal-error">{error}</p>}



        {pendingSubmitted && (

          <>

            <div className="renew-modal-line">

              ⏳ Yêu cầu tái tục đang chờ Admin duyệt (5–15 phút).

            </div>

            <div className="renew-modal-line renew-modal-muted">

              Bạn sẽ nhận thông báo khi Admin xác nhận chuyển khoản và kích hoạt tái tục.

            </div>

            <div className="renew-modal-actions">

              <button type="button" className="btn btn-primary" onClick={onClose}>

                Đóng

              </button>

            </div>

          </>

        )}



        {!loading && !pendingSubmitted && quote && !insufficient && preview && (

          <>

            <div className="renew-modal-line">

              📦 Gói: {displayName} ({billingLabel}) — {formatVnd(quote.price)}

            </div>

            <div className="renew-modal-line">

              ⏱️ Nhận: {quote.baseHours}h + {quote.comboBonus}h tặng ={' '}

              <strong>{quote.baseHours + quote.comboBonus}h</strong>

            </div>

            <div className="renew-modal-line">

              💰 Thanh toán từ Ví: {formatVnd(preview.walletBalance)} → còn{' '}

              {formatVnd(preview.balanceAfter ?? 0)}

            </div>

            <div className="renew-modal-actions">

              <button

                type="button"

                className="btn btn-primary"

                disabled={submitting}

                onClick={() => void handleConfirm()}

              >

                {submitting ? 'Đang xử lý...' : '✅ Xác nhận'}

              </button>

              <button type="button" className="btn btn-secondary" disabled={submitting} onClick={onClose}>

                Hủy

              </button>

            </div>

          </>

        )}



        {!loading && !pendingSubmitted && quote && insufficient && preview && (

          <>

            <div className="renew-modal-line">

              📦 Gói: {displayName} ({billingLabel}) — {formatVnd(quote.price)}

            </div>

            <div className="renew-modal-line renew-modal-warn">

              ⚠️ Số dư Ví: {formatVnd(preview.walletBalance)} — Thiếu:{' '}

              {formatVnd(preview.shortage ?? 0)}

            </div>

            <div className="renew-modal-line">

              🏦 Chuyển khoản bổ sung: {formatVnd(preview.shortage ?? 0)}

            </div>

            <div className="renew-modal-line renew-modal-muted">

              {WALLET_BANK_INFO.bankName} · STK {WALLET_BANK_INFO.accountNumber} ·{' '}

              {WALLET_BANK_INFO.accountName}

            </div>

            <div className="renew-modal-qr">🖼️ QR chuyển khoản</div>

            <div className="renew-modal-transfer">

              <span>Nội dung:</span>

              <strong>{preview.transferNote ?? 'TAITUC-...'}</strong>

            </div>

            <button type="button" className="renew-modal-copy" onClick={() => void copyTransferNote()}>

              {copySuccess ? '✅ Đã sao chép!' : '📋 Sao chép nội dung CK'}

            </button>

            <p className="renew-modal-hint">

              💡 Sau khi Admin duyệt: cộng tiền CK vào Ví, trừ phí tái tục và cộng giờ vào gói.

            </p>

            <label className="renew-modal-check">

              <input

                type="checkbox"

                checked={transferChecked}

                onChange={(e) => setTransferChecked(e.target.checked)}

              />

              Tôi xác nhận đã chuyển khoản đúng số tiền và nội dung

            </label>

            <div className="renew-modal-actions">

              <button

                type="button"

                className="btn btn-primary"

                disabled={submitting || !transferChecked}

                onClick={() => void handleTransferAck()}

              >

                {submitting ? 'Đang gửi...' : '✅ Tôi đã chuyển khoản'}

              </button>

              <button type="button" className="btn btn-secondary" disabled={submitting} onClick={onClose}>

                Hủy

              </button>

            </div>

          </>

        )}

      </div>

    </div>

  );

}


