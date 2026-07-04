import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import DashboardShell from '@/components/dashboard/DashboardShell';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { routes } from '@/lib/routes';
import { getPlanConfig } from '@/lib/gpu-pricing';
import { styles as dashboardStyles } from '@/styles/pages/dashboard.styles';
import { styles } from '@/styles/pages/dashboard-cai-dat.styles';

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
  return `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function grantPlanBadgeStyle(plan: string): CSSProperties {
  if (plan === 'starter') return { background: 'rgba(34, 197, 94, 0.18)', color: '#22C55E' };
  if (plan === 'studio') return { background: 'rgba(245, 158, 11, 0.18)', color: '#F59E0B' };
  return { background: 'rgba(139, 92, 246, 0.18)', color: '#8B5CF6' };
}

function grantPlanLabel(plan: string): string {
  const key = plan === 'starter' || plan === 'studio' ? plan : 'pro';
  const config = getPlanConfig(key);
  if (!config) return plan;
  return `${config.name} (${config.gpu})`;
}

export default function DashboardWalletPage() {
  const router = useRouter();
  const { user: authUser, loading: authLoading, session } = useAuth();
  const { user, loading, error } = useDashboard();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [hourGrants, setHourGrants] = useState<{
    totalHoursRemaining: number;
    nearestExpiry: string | null;
    notes: string[];
    recentlyUpdated: boolean;
    items?: Array<{
      id: number;
      hoursRemaining: number;
      gpuPlan: string;
      expiresAt: string | null;
      customerNote?: string | null;
      recentlyUpdated?: boolean;
    }>;
  } | null>(null);
  const [txLoading, setTxLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) router.replace(`${routes.login}?redirect=${routes.dashboardWallet}`);
  }, [authUser, authLoading, router]);

  const loadWallet = useCallback(async () => {
    if (!session?.access_token) return;
    setTxLoading(true);
    try {
      const [walletRes, grantsRes] = await Promise.all([
        fetch('/api/user/wallet?limit=100', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch('/api/user/my-grants', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);
      const data = await walletRes.json();
      if (walletRes.ok) {
        setBalance(data.balance ?? 0);
        setTransactions(data.transactions ?? []);
      }
      const grantsData = await grantsRes.json();
      if (grantsRes.ok) {
        setHourGrants(grantsData.summary ?? null);
      }
    } finally {
      setTxLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  if (authLoading || !authUser) return null;

  return (
    <>
      <Head>
        <title>GPUVietnam – Ví</title>
        <style dangerouslySetInnerHTML={{ __html: dashboardStyles + styles }} />
      </Head>
      <DashboardShell user={user} activeTab="wallet" title="Ví Nạp Trước" mainClassName="main-content settings-main">
        <Link href={routes.dashboardCaiDat} className="settings-back-link">
          ← Quay lại Cài đặt
        </Link>
        <h1 className="page-title">💰 Ví Nạp Trước</h1>
        <p className="page-subtitle">Lịch sử giao dịch và số dư hiện tại</p>

        {hourGrants && hourGrants.totalHoursRemaining > 0 && (
          <>
            {(hourGrants.items && hourGrants.items.length > 0
              ? hourGrants.items
              : [
                  {
                    id: 0,
                    hoursRemaining: hourGrants.totalHoursRemaining,
                    gpuPlan: 'pro',
                    expiresAt: hourGrants.nearestExpiry,
                    customerNote: hourGrants.notes[0] ?? null,
                    recentlyUpdated: hourGrants.recentlyUpdated,
                  },
                ]
            ).map((item) => (
              <div
                key={item.id}
                className="card"
                style={{
                  marginBottom: 16,
                  background: 'rgba(34, 197, 94, 0.12)',
                  borderColor: 'rgba(34, 197, 94, 0.35)',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span
                    style={{
                      ...grantPlanBadgeStyle(item.gpuPlan),
                      display: 'inline-flex',
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {getPlanConfig(
                      item.gpuPlan === 'starter' || item.gpuPlan === 'studio' ? item.gpuPlan : 'pro',
                    )?.name ?? item.gpuPlan}
                  </span>
                  <span style={{ fontWeight: 600, color: '#22C55E' }}>
                    🎁 Bạn có {item.hoursRemaining} giờ tặng gói {grantPlanLabel(item.gpuPlan)} — hết
                    hạn{' '}
                    {item.expiresAt
                      ? new Date(item.expiresAt).toLocaleDateString('vi-VN')
                      : 'Không giới hạn'}
                  </span>
                </div>
                {item.customerNote && (
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 0 }}>
                    {item.customerNote}
                  </p>
                )}
                {item.recentlyUpdated && (
                  <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-blue)', marginTop: 8, marginBottom: 0 }}>
                    Giờ tặng đã được cập nhật
                  </p>
                )}
              </div>
            ))}
          </>
        )}

        <div className="card">
          <div className="wallet-card" style={{ marginBottom: 0 }}>
            <div className="wallet-info">
              <div className="wallet-balance">{formatVnd(balance)}</div>
              <div className="wallet-hint">Số dư khả dụng</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">📜 LỊCH SỬ GIAO DỊCH</div>
          {loading || txLoading ? (
            <p className="settings-loading">Đang tải...</p>
          ) : error ? (
            <p style={{ color: '#f87171' }}>{error}</p>
          ) : transactions.length === 0 ? (
            <p className="settings-loading">Chưa có giao dịch nào.</p>
          ) : (
            <ul className="wallet-history-list wallet-history-full">
              {transactions.map((tx) => (
                <li key={tx.id}>
                  <div>
                    <strong>{tx.description ?? tx.type}</strong>
                    <span className="text-muted" style={{ display: 'block', fontSize: 11 }}>
                      {formatDate(tx.created_at)} · {tx.status}
                    </span>
                  </div>
                  <span className={tx.type === 'topup' ? 'text-green' : ''}>
                    {tx.type === 'payment' ? '-' : '+'}
                    {formatVnd(Number(tx.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DashboardShell>
    </>
  );
}
