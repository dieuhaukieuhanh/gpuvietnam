import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import DashboardShell from '@/components/dashboard/DashboardShell';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/dashboard.styles';

type StorageUpgrade = {
  id: string;
  current_ssd_gb: number;
  current_backup_gb: number;
  requested_ssd_gb: number;
  requested_backup_gb: number;
  price_change_per_month: number;
  total_amount: number;
  status: string;
  transfer_note: string | null;
};

export default function StorageCheckoutPage() {
  const router = useRouter();
  const { session, user: authUser, loading: authLoading } = useAuth();
  const { user } = useDashboard();

  const upgradeId = typeof router.query.id === 'string' ? router.query.id : '';

  const [upgrade, setUpgrade] = useState<StorageUpgrade | null>(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paymentMode, setPaymentMode] = useState<'wallet' | 'transfer'>('wallet');
  const [transferChecked, setTransferChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const loadUpgrade = useCallback(async () => {
    if (!session?.access_token || !upgradeId) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/storage/upgrade?id=${encodeURIComponent(upgradeId)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Không tải được thông tin thanh toán.');
        setUpgrade(null);
        return;
      }

      setUpgrade(data.upgrade as StorageUpgrade);
      setWalletBalance(Number(data.walletBalance ?? 0));

      if (data.upgrade?.status !== 'pending') {
        setError('Yêu cầu này không còn ở trạng thái chờ thanh toán.');
      }
    } catch {
      setError('Lỗi mạng khi tải thông tin.');
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, upgradeId]);

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) {
      router.replace(`${routes.login}?redirect=${routes.dashboardStorageCheckout}?id=${upgradeId}`);
      return;
    }
    if (router.isReady && upgradeId) loadUpgrade();
  }, [authLoading, authUser, router, upgradeId, loadUpgrade]);

  const transferNote =
    upgrade?.transfer_note ??
    `Nang cap bo nho SSD${upgrade?.requested_ssd_gb ?? ''} Backup${upgrade?.requested_backup_gb ?? ''}`;

  const totalAmount = Number(upgrade?.total_amount ?? 0);
  const canPayWallet = walletBalance >= totalAmount;

  const handlePayWallet = async () => {
    if (!session?.access_token || !upgrade) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/storage/pay-wallet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ upgradeId: upgrade.id }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Thanh toán ví thất bại.');
        return;
      }

      router.push(`${routes.dashboardStorage}?paid=1`);
    } catch {
      setError('Lỗi mạng khi thanh toán.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayTransfer = async () => {
    if (!session?.access_token || !upgrade || !transferChecked) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/storage/pay-transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ upgradeId: upgrade.id, transferNote }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Ghi nhận chuyển khoản thất bại.');
        return;
      }

      router.push(`${routes.dashboardStorage}?pending=1`);
    } catch {
      setError('Lỗi mạng khi ghi nhận chuyển khoản.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyTransfer = () => {
    navigator.clipboard.writeText(transferNote).then(() => {
      setCopySuccess(true);
      window.setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  if (authLoading || !authUser) return null;

  return (
    <>
      <Head>
        <title>GPUVietnam – Thanh toán bộ nhớ</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <DashboardShell
        user={user}
        activeTab="storage"
        title="Thanh toán bộ nhớ"
        mainClassName="main-content main-content--storage"
      >
        <div className="storage-checkout-page">
          <Link href={routes.dashboardStorage} className="storage-checkout-back">
            ← Quay lại Bộ nhớ
          </Link>

          <h2 className="storage-checkout-title">💳 Thanh toán nâng cấp bộ nhớ</h2>

          {loading && (
            <div className="card">
              <p style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
                Đang tải...
              </p>
            </div>
          )}

          {!loading && error && !upgrade && (
            <div className="card">
              <p style={{ padding: 24, color: '#f87171' }}>{error}</p>
            </div>
          )}

          {!loading && upgrade && (
            <>
              <div className="card storage-checkout-summary-card">
                <h3>Tóm tắt thay đổi</h3>
                <p>
                  SSD: <strong>{upgrade.current_ssd_gb}GB</strong> →{' '}
                  <strong>{upgrade.requested_ssd_gb}GB</strong>
                </p>
                <p>
                  Backup: <strong>{upgrade.current_backup_gb}GB</strong> →{' '}
                  <strong>{upgrade.requested_backup_gb}GB</strong>
                </p>
                <p className="storage-checkout-total">
                  Tổng thanh toán:{' '}
                  <strong>{new Intl.NumberFormat('vi-VN').format(totalAmount)}đ</strong>
                  <span className="storage-checkout-sub">
                    ({new Intl.NumberFormat('vi-VN').format(Number(upgrade.price_change_per_month))}
                    đ/tháng)
                  </span>
                </p>
              </div>

              {error && <div className="storage-checkout-error">{error}</div>}

              <div className="storage-checkout-methods">
                <button
                  type="button"
                  className={`storage-checkout-method${paymentMode === 'wallet' ? ' active' : ''}`}
                  onClick={() => setPaymentMode('wallet')}
                >
                  <span className="method-icon">👛</span>
                  <span className="method-label">Thanh toán Ví</span>
                  <span className="method-meta">
                    Số dư: {new Intl.NumberFormat('vi-VN').format(walletBalance)}đ
                  </span>
                </button>
                <button
                  type="button"
                  className={`storage-checkout-method${paymentMode === 'transfer' ? ' active' : ''}`}
                  onClick={() => setPaymentMode('transfer')}
                >
                  <span className="method-icon">🏦</span>
                  <span className="method-label">Chuyển khoản</span>
                  <span className="method-meta">Chờ Admin duyệt 5–10 phút</span>
                </button>
              </div>

              {paymentMode === 'wallet' && (
                <div className="card storage-checkout-panel">
                  <p>
                    Thanh toán ngay từ ví GPUVietnam. Gói bộ nhớ được cập nhật tức thì sau khi trừ
                    tiền.
                  </p>
                  {!canPayWallet && (
                    <p className="storage-checkout-warn">
                      Số dư không đủ. Nạp thêm ví hoặc chọn Chuyển khoản.
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%', marginTop: 12 }}
                    disabled={submitting || !canPayWallet}
                    onClick={handlePayWallet}
                  >
                    {submitting ? 'Đang xử lý...' : `Thanh toán ${totalAmount.toLocaleString('vi-VN')}đ từ Ví`}
                  </button>
                </div>
              )}

              {paymentMode === 'transfer' && (
                <div className="card storage-checkout-panel">
                  <p className="subtitle">Quét mã QR hoặc chuyển khoản theo thông tin bên dưới</p>
                  <div className="storage-checkout-qr">🖼️ QR thanh toán</div>
                  <div className="storage-checkout-transfer-note">
                    <strong>Nội dung CK:</strong>
                    <div className="highlight">{transferNote}</div>
                  </div>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={copyTransfer}>
                    {copySuccess ? '✅ Đã sao chép' : '📋 Sao chép nội dung CK'}
                  </button>
                  <label className="storage-checkout-check">
                    <input
                      type="checkbox"
                      checked={transferChecked}
                      onChange={(e) => setTransferChecked(e.target.checked)}
                    />
                    Tôi xác nhận đã chuyển khoản đúng nội dung
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%', marginTop: 12 }}
                    disabled={submitting || !transferChecked}
                    onClick={handlePayTransfer}
                  >
                    {submitting ? 'Đang ghi nhận...' : '✅ Tôi đã chuyển khoản'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </DashboardShell>
    </>
  );
}
