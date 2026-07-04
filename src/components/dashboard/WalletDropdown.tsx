import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import WalletDepositForm from '@/components/dashboard/WalletDepositForm';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/gpu-pricing';
import { routes } from '@/lib/routes';

type WalletTab = 'topup' | 'use' | 'history';

type WalletTransaction = {
  id: string;
  type: string;
  amount: number;
  bonus_amount: number;
  description: string | null;
  status: string;
  created_at: string;
};

function formatVnd(amount: number) {
  return formatCurrency(amount);
}

function formatTxDate(iso: string) {
  return new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getBalanceTone(balance: number): 'high' | 'low' | 'zero' {
  if (balance === 0) return 'zero';
  if (balance > 100_000) return 'high';
  return 'low';
}

const USE_LINKS = [
  { icon: '⏱️', title: 'Mua giờ GPU', desc: 'Thuê theo giờ — linh hoạt', href: routes.checkout2 },
  { icon: '📦', title: 'Mua gói Combo', desc: 'Combo 1 & Combo 2', href: routes.checkoutPlan },
  { icon: '💾', title: 'Nâng cấp bộ nhớ', desc: 'SSD & Backup', href: routes.dashboardStorage },
  { icon: '🔄', title: 'Gia hạn tự động', desc: 'Cài đặt gia hạn qua Ví', href: routes.dashboardCaiDat },
];

export default function WalletDropdown() {
  const { session } = useAuth();

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<WalletTab>('topup');
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [depositFormKey, setDepositFormKey] = useState(0);
  const [depositStep, setDepositStep] = useState<'amount' | 'transfer'>('amount');

  const token = session?.access_token ?? '';

  const loadWallet = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/user/wallet?limit=5', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setBalance(data.balance ?? 0);
        setTransactions(data.transactions ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  useEffect(() => {
    if (open) loadWallet();
  }, [open, loadWallet]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) setDepositStep('amount');
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, handleClose]);

  const handleDepositClose = () => {
    setDepositFormKey((k) => k + 1);
    setDepositStep('amount');
    setOpen(false);
  };

  const balanceTone = getBalanceTone(balance);

  const modal = open && mounted ? (
    <div
      className="wallet-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
      role="presentation"
    >
      <div
        className={`wallet-dropdown-modal${depositStep === 'transfer' ? ' is-deposit-transfer' : ' is-deposit-amount'}`}
        role="dialog"
        aria-modal="true"
        aria-label="Ví Nạp Trước"
      >
        <button type="button" className="close-btn" onClick={handleClose} aria-label="Đóng">
          ✕
        </button>

        <div className="wallet-dropdown-head">
          <div className="wallet-dropdown-head-title">💰 Ví Nạp Trước</div>
          <div className={`wallet-dropdown-balance tone-${balanceTone}`}>
            Số dư: {formatVnd(balance)}
          </div>
        </div>

        <div className="wallet-dropdown-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'topup'}
            className={`wallet-dropdown-tab${tab === 'topup' ? ' active' : ''}`}
            onClick={() => {
              setDepositStep('amount');
              setTab('topup');
            }}
          >
            💰 Nạp ví
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'use'}
            className={`wallet-dropdown-tab${tab === 'use' ? ' active' : ''}`}
            onClick={() => setTab('use')}
          >
            🛒 Sử dụng
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            className={`wallet-dropdown-tab${tab === 'history' ? ' active' : ''}`}
            onClick={() => setTab('history')}
          >
            📜 Lịch sử
          </button>
        </div>

        <div className="wallet-dropdown-body">
          {tab === 'topup' && (
            <div className="wallet-dropdown-tab-panel">
              {token ? (
                <WalletDepositForm
                  key={depositFormKey}
                  accessToken={token}
                  compact
                  onStepChange={setDepositStep}
                  onClose={handleDepositClose}
                  onSubmitted={() => void loadWallet()}
                  onError={(message) => alert(message)}
                />
              ) : (
                <p className="wallet-dropdown-empty">Vui lòng đăng nhập để nạp Ví.</p>
              )}
            </div>
          )}

          {tab === 'use' && (
            <div className="wallet-dropdown-tab-panel">
              <div className="wallet-use-grid">
                {USE_LINKS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="wallet-use-card"
                    onClick={handleClose}
                  >
                    <span className="wallet-use-card-icon">{item.icon}</span>
                    <div>
                      <div className="wallet-use-card-title">{item.title}</div>
                      <div className="wallet-use-card-desc">{item.desc}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {tab === 'history' && (
            <div className="wallet-dropdown-tab-panel">
              {loading ? (
                <p className="wallet-dropdown-empty">Đang tải...</p>
              ) : transactions.length === 0 ? (
                <p className="wallet-dropdown-empty">Chưa có giao dịch nào.</p>
              ) : (
                <ul className="wallet-dropdown-history">
                  {transactions.map((tx) => {
                    const isCredit =
                      (tx.type === 'deposit' ||
                        tx.type === 'topup' ||
                        tx.type === 'bonus' ||
                        tx.type === 'refund') &&
                      tx.status === 'completed';
                    const isPending =
                      tx.status === 'pending_deposit' || tx.status === 'pending';
                    return (
                      <li key={tx.id} className="wallet-dropdown-history-item">
                        <div>
                          <div className="wallet-dropdown-history-desc">
                            {tx.description ?? tx.type}
                            {isPending && (
                              <span className="wallet-tx-pending"> · Chờ duyệt</span>
                            )}
                          </div>
                          <div className="wallet-dropdown-history-date">
                            {formatTxDate(tx.created_at)}
                          </div>
                        </div>
                        <span
                          className={
                            isCredit ? 'amount-plus' : isPending ? 'amount-pending' : 'amount-minus'
                          }
                        >
                          {isCredit || isPending ? '+' : '-'}
                          {formatVnd(Number(tx.amount))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Link
                href={routes.dashboardWallet}
                className="wallet-dropdown-view-all"
                onClick={handleClose}
              >
                Xem tất cả →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="wallet-dropdown-wrap">
      <button
        type="button"
        className={`wallet-dropdown-trigger tone-${balanceTone}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="wallet-dropdown-trigger-icon">💰</span>
        <span className="wallet-dropdown-trigger-amount">{formatVnd(balance)}</span>
        <span className="wallet-dropdown-trigger-chevron" aria-hidden>
          ▾
        </span>
      </button>

      {mounted && modal ? createPortal(modal, document.body) : null}
    </div>
  );
}