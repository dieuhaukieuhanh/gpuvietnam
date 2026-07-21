import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import DashboardShell from '@/components/dashboard/DashboardShell';
import WalletDepositForm from '@/components/dashboard/WalletDepositForm';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { routes } from '@/lib/routes';
import { getPlanConfig } from '@/lib/gpu-pricing';
import { styles as dashboardStyles } from '@/styles/pages/dashboard.styles';
import { styles } from '@/styles/pages/dashboard-cai-dat.styles';

type WalletServiceAction = {
  label: string;
  href?: string;
  primary?: boolean;
};

const WALLET_SERVICE_CARDS: ReadonlyArray<{
  key: string;
  icon: string;
  title: string;
  desc: string;
  actions: WalletServiceAction[];
}> = [
  {
    key: 'hours-renew',
    icon: '⏱️',
    title: 'Nạp giờ & Tái tục',
    desc: 'Gia hạn gói đang dùng hoặc mua thêm giờ linh hoạt.',
    actions: [
      { label: 'Tái tục gói', href: routes.dashboardGoiCuaToi, primary: true },
      { label: 'Mua thêm giờ', href: routes.checkout2 },
    ],
  },
  {
    key: 'combo',
    icon: '📦',
    title: 'Mua gói Combo ưu đãi',
    desc: 'Combo 1 & Combo 2 — kích hoạt ngay sau thanh toán.',
    actions: [{ label: 'Chọn gói', href: routes.checkoutPlan, primary: true }],
  },
];

type WalletTransaction = {
  id: string;
  type: string;
  amount: number;
  bonus_amount: number;
  description: string | null;
  status: string;
  created_at: string;
};

type AutoRenewSettings = {
  autoRenewEnabled: boolean;
  autoRenewMethod: 'wallet' | 'transfer';
  autoRenewThreshold: number;
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

async function authFetch(path: string, token: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(path, { ...options, headers });
}

export default function DashboardWalletPage() {
  const router = useRouter();
  const { user: authUser, loading: authLoading, session } = useAuth();
  const { user, billingType, loading, error } = useDashboard();
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
  const [walletError, setWalletError] = useState('');
  const [showTopupModal, setShowTopupModal] = useState(false);
  const [depositStep, setDepositStep] = useState<'amount' | 'transfer'>('amount');
  const [autoRenew, setAutoRenew] = useState<AutoRenewSettings>({
    autoRenewEnabled: false,
    autoRenewMethod: 'wallet',
    autoRenewThreshold: 10,
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [showAllTransactions, setShowAllTransactions] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) router.replace(`${routes.login}?redirect=${routes.dashboardWallet}`);
  }, [authUser, authLoading, router]);

  const loadWallet = useCallback(async () => {
    if (!session?.access_token) return;
    setTxLoading(true);
    setWalletError('');
    try {
      const [walletRes, grantsRes, settingsRes] = await Promise.all([
        fetch('/api/user/wallet?limit=100', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch('/api/user/my-grants', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        authFetch('/api/user/settings', session.access_token),
      ]);
      const data = await walletRes.json();
      if (walletRes.ok) {
        setBalance(data.balance ?? 0);
        setTransactions(data.transactions ?? []);
      } else {
        setWalletError(data.error ?? 'Không tải được lịch sử giao dịch.');
      }
      const grantsData = await grantsRes.json();
      if (grantsRes.ok) {
        setHourGrants(grantsData.summary ?? null);
      }
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        const s = settingsData.settings;
        if (s) {
          setAutoRenew({
            autoRenewEnabled: Boolean(s.autoRenewEnabled),
            autoRenewMethod: s.autoRenewMethod === 'transfer' ? 'transfer' : 'wallet',
            autoRenewThreshold: Number(s.autoRenewThreshold ?? 10),
          });
        }
      }
    } finally {
      setTxLoading(false);
    }
  }, [session?.access_token]);

  const saveAutoRenew = useCallback(
    async (patch: Partial<AutoRenewSettings>) => {
      if (!session?.access_token) return;
      setSavingSettings(true);
      try {
        const res = await authFetch('/api/user/settings', session.access_token, {
          method: 'PUT',
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Cập nhật thất bại.');
        const s = data.settings;
        if (s) {
          setAutoRenew({
            autoRenewEnabled: Boolean(s.autoRenewEnabled),
            autoRenewMethod: s.autoRenewMethod === 'transfer' ? 'transfer' : 'wallet',
            autoRenewThreshold: Number(s.autoRenewThreshold ?? 10),
          });
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Cập nhật thất bại.');
      } finally {
        setSavingSettings(false);
      }
    },
    [session?.access_token],
  );

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  if (authLoading || !authUser) return null;

  return (
    <>
      <Head>
        <title>GPUVietnam – Ví nạp trước</title>
        <style dangerouslySetInnerHTML={{ __html: dashboardStyles + styles }} />
      </Head>
      <DashboardShell user={user} activeTab="wallet" title="Ví nạp trước" mainClassName="main-content settings-main">
        <Link href={routes.dashboard} className="settings-back-link">
          ← Quay lại Trung tâm
        </Link>
        <h1 className="page-title">💰 Ví nạp trước</h1>
        <p className="page-subtitle">Số dư khả dụng và mua thêm dịch vụ trên nền tảng</p>

        {error && (
          <div className="alert-card warning" style={{ display: 'flex', marginBottom: 16 }}>
            <span className="alert-icon">⚠️</span>
            <div className="alert-content">
              <div className="alert-desc">{error}</div>
            </div>
          </div>
        )}

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

        <div className="wallet-page-layout">
          <div className="wallet-page-main">
            <div className="card wallet-main-card">
              <div className="card-header">💰 VÍ NẠP TRƯỚC</div>
              <div className="wallet-card">
                <div className="wallet-info">
                  <div className="wallet-balance">{formatVnd(balance)}</div>
                  <div className="wallet-hint">Số dư tự động dùng để gia hạn gói khi đến hạn.</div>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => setShowTopupModal(true)}>
                  ⚡ Nạp thêm
                </button>
              </div>

              {billingType === 'combo' && (
                <>
                  <div className="auto-renew-divider" />
                  <div className="auto-renew-section">
                    <div className="auto-renew-section-top">
                      <div className="auto-renew-section-header">🔄 GIA HẠN TỰ ĐỘNG</div>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={autoRenew.autoRenewEnabled}
                          disabled={savingSettings}
                          onChange={(e) =>
                            saveAutoRenew({
                              autoRenewEnabled: e.target.checked,
                              autoRenewMethod: 'wallet',
                            })
                          }
                        />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                    <p className="auto-renew-section-desc">
                      Tự động tái tục gói Combo khi giờ còn lại dưới ngưỡng
                    </p>

                    <div className="settings-auto-renew-threshold">
                      <label htmlFor="autoRenewThreshold">
                        Còn{' '}
                        <select
                          id="autoRenewThreshold"
                          value={autoRenew.autoRenewThreshold ?? 10}
                          disabled={savingSettings}
                          onChange={(e) =>
                            saveAutoRenew({ autoRenewThreshold: Number(e.target.value) })
                          }
                        >
                          {[5, 10, 15, 20].map((h) => (
                            <option key={h} value={h}>
                              {h}h
                            </option>
                          ))}
                        </select>{' '}
                        thì tự động gia hạn
                      </label>
                    </div>

                    <div className="auto-renew-note">
                      <strong>📌 Lưu ý:</strong>
                      <ul>
                        <li>Chỉ áp dụng cho gói Combo 1 &amp; Combo 2</li>
                        <li>Hệ thống chỉ gia hạn khi số dư Ví ≥ số tiền cần để tái tục</li>
                        <li>Thưởng +3% giờ chỉ khi tái tục tự động lúc còn ≥10h</li>
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="card">
              <div className="card-header">📜 LỊCH SỬ GIAO DỊCH</div>
              {loading || txLoading ? (
                <p className="settings-loading">Đang tải...</p>
              ) : walletError ? (
                <p style={{ color: '#f87171' }}>{walletError}</p>
              ) : transactions.length === 0 ? (
                <p className="settings-loading">Chưa có giao dịch nào.</p>
              ) : (
                <>
                  <ul className="wallet-history-list wallet-history-full">
                    {(showAllTransactions ? transactions : transactions.slice(0, 7)).map((tx) => (
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
                  {transactions.length > 7 && (
                    <button
                      type="button"
                      className="wallet-history-toggle"
                      onClick={() => setShowAllTransactions((v) => !v)}
                    >
                      {showAllTransactions
                        ? `▲ Thu gọn`
                        : `▼ Xem thêm ${transactions.length - 7} giao dịch`}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <aside className="wallet-page-aside" aria-label="Mua thêm dịch vụ">
            {WALLET_SERVICE_CARDS.map((card) => (
              <article key={card.key} className="wallet-service-card">
                <div className="wallet-service-card-head">
                  <span className="wallet-service-card-icon" aria-hidden>
                    {card.icon}
                  </span>
                  <div>
                    <h3 className="wallet-service-card-title">{card.title}</h3>
                    <p className="wallet-service-card-desc">{card.desc}</p>
                  </div>
                </div>
                <div className="wallet-service-card-actions">
                  {card.actions.map((action) => {
                    const cls = `wallet-service-card-link${action.primary ? ' primary' : ''}`;
                    return (
                      <Link key={action.href} href={action.href ?? '#'} className={cls}>
                        {action.label}
                      </Link>
                    );
                  })}
                </div>
              </article>
            ))}
          </aside>
        </div>

        <div
          className={`modal-overlay${showTopupModal ? ' active' : ''}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setDepositStep('amount');
              setShowTopupModal(false);
            }
          }}
          role="presentation"
        >
          <div
            className={`modal wallet-deposit-modal${depositStep === 'transfer' ? ' is-deposit-transfer' : ''}`}
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              className="close-btn"
              onClick={() => {
                setDepositStep('amount');
                setShowTopupModal(false);
              }}
            >
              ✕
            </button>
            {depositStep === 'amount' ? (
              <>
                <h3>💰 Nạp vào Ví</h3>
                <p className="modal-subtitle">
                  Nhập số tiền chuyển khoản — Admin duyệt trong ~15 phút.
                </p>
              </>
            ) : (
              <h3 className="wallet-deposit-modal-transfer-title">💰 Thông tin chuyển khoản</h3>
            )}
            {session?.access_token ? (
              <WalletDepositForm
                accessToken={session.access_token}
                onStepChange={setDepositStep}
                onClose={() => {
                  setDepositStep('amount');
                  setShowTopupModal(false);
                }}
                onSubmitted={() => void loadWallet()}
                onError={(message) => alert(message)}
              />
            ) : null}
          </div>
        </div>
      </DashboardShell>
    </>
  );
}
