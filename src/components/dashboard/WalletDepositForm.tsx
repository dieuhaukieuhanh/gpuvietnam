import { useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '@/lib/gpu-pricing';
import {
  MIN_WALLET_DEPOSIT,
  WALLET_DEPOSIT_QUICK_OPTIONS,
} from '@/lib/wallet-deposit';
import { WALLET_RENEW_HINTS } from '@/lib/wallet-topup';

export type DepositPendingData = {
  transaction: {
    id: string;
    amount: number;
    status: string;
    description: string | null;
    created_at: string;
    shortId: string;
  };
  transfer: {
    bankName: string;
    accountNumber: string;
    accountName: string;
    amount: number;
    transferNote: string;
    expectedMinutes: number;
    expectedLabel: string;
  };
};

type DepositStep = 'amount' | 'transfer';

type WalletDepositFormProps = {
  accessToken: string;
  onClose?: () => void;
  onSubmitted?: (pending: DepositPendingData) => void;
  onError?: (message: string) => void;
  onStepChange?: (step: DepositStep) => void;
  submitLabel?: string;
  showHints?: boolean;
  compact?: boolean;
};

function formatAmountInput(value: number): string {
  if (!value) return '';
  return new Intl.NumberFormat('vi-VN').format(value);
}

function parseDigits(value: string): number {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

function formatVnd(amount: number) {
  return formatCurrency(amount);
}

type WalletDepositPendingViewProps = {
  pending: DepositPendingData;
  onConfirm: () => void;
};

function WalletDepositPendingView({ pending, onConfirm }: WalletDepositPendingViewProps) {
  const [copySuccess, setCopySuccess] = useState(false);
  const [transferred, setTransferred] = useState(false);
  const { transaction, transfer } = pending;

  const copyTransferNote = async () => {
    try {
      await navigator.clipboard.writeText(transfer.transferNote);
      setCopySuccess(true);
      window.setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="wallet-deposit-pending">
      <div className="wallet-deposit-pending-head">
        <span className="wallet-deposit-pending-icon" aria-hidden>
          ⏳
        </span>
        <div className="wallet-deposit-pending-head-text">
          <h4 className="wallet-deposit-pending-title">Chờ Admin duyệt</h4>
          <p className="wallet-deposit-pending-subtitle">
            Chuyển khoản đúng số tiền và nội dung CK bên dưới
          </p>
        </div>
      </div>

      <div className="wallet-deposit-pending-main">
        <div className="wallet-deposit-pending-qr">
          <span className="wallet-deposit-pending-qr-icon" aria-hidden>
            🖼️
          </span>
          <span>Quét QR chuyển khoản</span>
        </div>

        <dl className="wallet-deposit-pending-grid">
          <dt>Ngân hàng</dt>
          <dd>{transfer.bankName}</dd>
          <dt>Số tài khoản</dt>
          <dd>{transfer.accountNumber}</dd>
          <dt>Chủ tài khoản</dt>
          <dd>{transfer.accountName}</dd>
          <dt>Số tiền CK</dt>
          <dd>{formatVnd(transfer.amount)}</dd>
          <dt>Mã GD</dt>
          <dd className="mono">#{transaction.shortId}</dd>
        </dl>
      </div>

      <div className="wallet-deposit-pending-note">
        <div className="wallet-deposit-pending-note-text">
          <span>Nội dung CK</span>
          <strong>{transfer.transferNote}</strong>
        </div>
        <button type="button" className="wallet-deposit-copy" onClick={() => void copyTransferNote()}>
          {copySuccess ? '✅ Đã copy' : '📋 Copy'}
        </button>
      </div>

      <p className="wallet-deposit-pending-eta">
        ⏱️ Duyệt trong {transfer.expectedLabel} (giờ hành chính)
      </p>

      <div className="wallet-deposit-pending-foot">
        <label className="wallet-deposit-check wallet-deposit-pending-check">
          <input
            type="checkbox"
            checked={transferred}
            onChange={(e) => setTransferred(e.target.checked)}
          />
          <span>Tôi đã thực hiện chuyển khoản</span>
        </label>

        <button
          type="button"
          className={`btn btn-primary wallet-deposit-close${transferred ? '' : ' btn-disabled'}`}
          disabled={!transferred}
          onClick={onConfirm}
        >
          Xác nhận
        </button>
      </div>
    </div>
  );
}

export default function WalletDepositForm({
  accessToken,
  onClose,
  onSubmitted,
  onError,
  onStepChange,
  submitLabel = 'Tiếp tục',
  showHints = true,
  compact = false,
}: WalletDepositFormProps) {
  const [amount, setAmount] = useState(200_000);
  const [amountInput, setAmountInput] = useState(formatAmountInput(200_000));
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState<DepositPendingData | null>(null);

  useEffect(() => {
    if (pending) onStepChange?.('transfer');
  }, [pending, onStepChange]);

  const amountError = useMemo(() => {
    if (!Number.isInteger(amount) || amount < MIN_WALLET_DEPOSIT) {
      return `Số tiền tối thiểu ${MIN_WALLET_DEPOSIT.toLocaleString('vi-VN')}đ.`;
    }
    return '';
  }, [amount]);

  const canContinue =
    !amountError && !submitting && amount >= MIN_WALLET_DEPOSIT;

  const handleAmountChange = (value: string) => {
    const parsed = parseDigits(value);
    setAmount(parsed);
    setAmountInput(parsed ? formatAmountInput(parsed) : '');
  };

  const selectQuickAmount = (value: number) => {
    setAmount(value);
    setAmountInput(formatAmountInput(value));
    setTouched(false);
  };

  const resetForm = () => {
    setPending(null);
    setTouched(false);
    onStepChange?.('amount');
  };

  const handleConfirmPending = () => {
    resetForm();
    onClose?.();
  };

  const handleContinue = async () => {
    setTouched(true);
    if (!canContinue || !accessToken) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/user/wallet/deposit', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (!res.ok) {
        onError?.(data.error ?? 'Nạp thất bại.');
        return;
      }
      if (data.pending) {
        setPending(data.pending as DepositPendingData);
        onStepChange?.('transfer');
        onSubmitted?.(data.pending as DepositPendingData);
      }
    } catch {
      onError?.('Lỗi mạng khi gửi yêu cầu nạp.');
    } finally {
      setSubmitting(false);
    }
  };

  if (pending) {
    return <WalletDepositPendingView pending={pending} onConfirm={handleConfirmPending} />;
  }

  return (
    <div className={`wallet-deposit-form${compact ? ' wallet-deposit-form--compact' : ''}`}>
      <label className="wallet-deposit-label" htmlFor="wallet-deposit-amount">
        Số tiền nạp (VNĐ)
      </label>
      <input
        id="wallet-deposit-amount"
        type="text"
        inputMode="numeric"
        className={`wallet-deposit-input${touched && amountError ? ' has-error' : ''}`}
        value={amountInput}
        placeholder={`Tối thiểu ${formatCurrency(MIN_WALLET_DEPOSIT)}`}
        onChange={(e) => handleAmountChange(e.target.value)}
        onBlur={() => setTouched(true)}
      />
      {touched && amountError && <p className="wallet-deposit-error">{amountError}</p>}

      <div className="wallet-deposit-quick">
        {WALLET_DEPOSIT_QUICK_OPTIONS.map((opt) => (
          <button
            key={opt.amount}
            type="button"
            className={`wallet-deposit-quick-btn${amount === opt.amount ? ' selected' : ''}`}
            onClick={() => selectQuickAmount(opt.amount)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {showHints && !compact && WALLET_RENEW_HINTS.length > 0 && (
        <div className="wallet-topup-hints">
          {WALLET_RENEW_HINTS.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}

      <button
        type="button"
        className={`btn btn-primary wallet-deposit-submit${canContinue ? '' : ' btn-disabled'}`}
        disabled={!canContinue}
        onClick={() => void handleContinue()}
      >
        {submitting ? 'Đang xử lý...' : submitLabel}
      </button>
    </div>
  );
}
