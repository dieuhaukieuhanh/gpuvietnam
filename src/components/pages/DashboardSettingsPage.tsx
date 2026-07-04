import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { BillingType, DashboardUser } from '@/hooks/useDashboard';
import { routes } from '@/lib/routes';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import WalletDepositForm from '@/components/dashboard/WalletDepositForm';
import { WALLET_RENEW_HINTS } from '@/lib/wallet-topup';

type WalletTransaction = {
  id: string;
  type: string;
  amount: number;
  bonus_amount: number;
  description: string | null;
  status: string;
  created_at: string;
};

type NotificationSettings = {
  zaloEnabled: boolean;
  emailEnabled: boolean;
  eventLowHours: boolean;
  eventExpiring: boolean;
  eventBackupFull: boolean;
  eventPaymentSuccess: boolean;
};

type UserSettings = {
  autoRenewEnabled: boolean;
  autoRenewMethod: 'wallet' | 'transfer';
  autoRenewThreshold: number;
  autoTopupEnabled: boolean;
  autoTopupThreshold: number;
  autoTopupAmount: number;
  autoTopupWarnEnabled: boolean;
  theme: 'light' | 'dark';
  autoRenewPreview: {
    hoursRemaining: number | null;
    withinThreshold: boolean;
    renewPrice: number;
    walletBalance: number;
    canAutoRenew: boolean;
    badge: 'ready' | 'low_balance' | null;
  } | null;
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

function maskPhone(phone: string | null) {
  if (!phone) return '—';
  if (phone.length < 4) return phone;
  return `${phone.slice(0, 2)}${'x'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-2)}`;
}

async function authFetch(path: string, token: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(path, { ...options, headers });
}

type ToggleRowProps = {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

function ToggleRow({ label, desc, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <div className="toggle-row">
      <div>
        <div className="toggle-label">{label}</div>
        {desc && <div className="toggle-desc">{desc}</div>}
      </div>
      <label className="toggle-switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}

type DashboardSettingsPageProps = {
  user: DashboardUser | null;
  billingType: BillingType;
  loading: boolean;
  error: string;
  onRefresh: () => void;
};

export default function DashboardSettingsPage({
  user,
  billingType,
  loading,
  error,
  onRefresh,
}: DashboardSettingsPageProps) {
  const { session, signOut } = useAuth();

  const [fullName, setFullName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [walletBalance, setWalletBalance] = useState(0);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [showTopupModal, setShowTopupModal] = useState(false);
  const [depositStep, setDepositStep] = useState<'amount' | 'transfer'>('amount');

  const [userSettings, setUserSettings] = useState<UserSettings>({
    autoRenewEnabled: false,
    autoRenewMethod: 'wallet',
    autoRenewThreshold: 10,
    autoTopupEnabled: false,
    autoTopupThreshold: 50_000,
    autoTopupAmount: 200_000,
    autoTopupWarnEnabled: true,
    theme: 'dark',
    autoRenewPreview: null,
  });
  const [notifications, setNotifications] = useState<NotificationSettings>({
    zaloEnabled: true,
    emailEnabled: true,
    eventLowHours: true,
    eventExpiring: true,
    eventBackupFull: true,
    eventPaymentSuccess: true,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneStep, setPhoneStep] = useState<'input' | 'otp'>('input');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [toast, setToast] = useState('');
  const [displayPhone, setDisplayPhone] = useState<string | null>(null);

  const token = session?.access_token ?? '';

  const loadExtras = useCallback(async () => {
    if (!token) return;

    try {
      const [walletRes, notifRes, settingsRes] = await Promise.all([
        authFetch('/api/user/wallet', token),
        authFetch('/api/user/notifications', token),
        authFetch('/api/user/settings', token),
      ]);

      const walletData = await walletRes.json();
      const notifData = await notifRes.json();
      const settingsData = await settingsRes.json();

      if (walletRes.ok) {
        setWalletBalance(walletData.balance ?? 0);
        setTransactions(walletData.transactions ?? []);
      }
      if (notifRes.ok) setNotifications(notifData.settings);
      if (settingsRes.ok) {
        setUserSettings(settingsData.settings);
        applyTheme(settingsData.settings.theme);
      }
    } catch {
      /* optional data */
    }
  }, [token]);

  useEffect(() => {
    const saved = localStorage.getItem('gpuvietnam-theme');
    if (saved === 'light' || saved === 'dark') {
      applyTheme(saved);
    }
  }, []);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName ?? user.displayName ?? '');
      setDisplayPhone(user.phone);
      setWalletBalance(user.walletBalance ?? 0);
    }
  }, [user]);

  useEffect(() => {
    loadExtras();
  }, [loadExtras]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  function applyTheme(theme: 'light' | 'dark') {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('gpuvietnam-theme', theme);
  }

  const handleSaveProfile = async () => {
    if (!token) return;
    setSavingProfile(true);
    try {
      const res = await authFetch('/api/user/profile', token, {
        method: 'PUT',
        body: JSON.stringify({ fullName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Lưu thất bại.');
      setToast('Đã lưu thông tin cá nhân.');
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Lưu thất bại.');
    } finally {
      setSavingProfile(false);
    }
  };

  const saveUserSettings = async (patch: Partial<UserSettings>) => {
    if (!token) return;
    setSavingSettings(true);
    try {
      const res = await authFetch('/api/user/settings', token, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Cập nhật thất bại.');
      setUserSettings(data.settings);
      if (patch.theme) applyTheme(patch.theme);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Cập nhật thất bại.');
    } finally {
      setSavingSettings(false);
    }
  };

  const saveNotifications = async (patch: Partial<NotificationSettings>) => {
    if (!token) return;
    setSavingSettings(true);
    try {
      const res = await authFetch('/api/user/notifications', token, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Cập nhật thất bại.');
      setNotifications(data.settings);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Cập nhật thất bại.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleChangePassword = async () => {
    if (!token) return;
    if (newPassword !== confirmPassword) {
      alert('Mật khẩu xác nhận không khớp.');
      return;
    }
    setPasswordBusy(true);
    try {
      const res = await authFetch('/api/user/password', token, {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Đổi mật khẩu thất bại.');
      setShowPasswordModal(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setToast('Đã đổi mật khẩu.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Đổi mật khẩu thất bại.');
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleSendPhoneOtp = async () => {
    if (!token) return;
    setPhoneBusy(true);
    setDevOtp(null);
    try {
      const res = await authFetch('/api/user/change-phone', token, {
        method: 'POST',
        body: JSON.stringify({ phone: newPhone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Gửi OTP thất bại.');
      setPhoneStep('otp');
      if (data.devOtp) setDevOtp(data.devOtp);
      setToast('Đã gửi OTP đến số mới.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gửi OTP thất bại.');
    } finally {
      setPhoneBusy(false);
    }
  };

  const handleVerifyPhone = async () => {
    if (!token) return;
    setPhoneBusy(true);
    try {
      const res = await authFetch('/api/user/verify-phone', token, {
        method: 'POST',
        body: JSON.stringify({ phone: newPhone, otp: phoneOtp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Xác nhận thất bại.');
      setDisplayPhone(data.profile.phone);
      setShowPhoneModal(false);
      setPhoneStep('input');
      setNewPhone('');
      setPhoneOtp('');
      setDevOtp(null);
      setToast('Đã cập nhật số điện thoại.');
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Xác nhận thất bại.');
    } finally {
      setPhoneBusy(false);
    }
  };

  const handleSignOutAll = async () => {
    if (!confirm('Đăng xuất tất cả thiết bị? Bạn sẽ cần đăng nhập lại.')) return;
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut({ scope: 'global' });
    await signOut();
  };

  const handleDeleteBackup = async () => {
    if (!token) return;
    setDeleteBusy(true);
    try {
      const res = await authFetch('/api/user/delete-backup', token, {
        method: 'POST',
        body: JSON.stringify({ confirmText: deleteConfirm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Xóa thất bại.');
      setShowDeleteModal(false);
      setDeleteConfirm('');
      setToast(data.message ?? 'Đã xóa backup.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Xóa thất bại.');
    } finally {
      setDeleteBusy(false);
    }
  };

  if (loading) {
    return <p className="settings-loading">Đang tải cài đặt...</p>;
  }

  if (error) {
    return (
      <div className="card">
        <p style={{ color: '#f87171' }}>{error}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh}>
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <h1 className="page-title">⚙️ Cài đặt</h1>
      <p className="page-subtitle">Quản lý thông tin cá nhân và tùy chỉnh trải nghiệm</p>

      <div className="settings-grid">
        {/* Thông tin cá nhân */}
        <div className="card settings-card">
          <div className="card-header">👤 THÔNG TIN CÁ NHÂN</div>
          <div className="form-group">
            <label className="form-label">Họ tên</label>
            <input
              type="text"
              className="form-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nhập họ tên"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input type="email" className="form-input" value={user?.email ?? ''} readOnly />
            <p className="form-hint">Email dùng để đăng nhập — không thể thay đổi.</p>
          </div>
          <div className="form-group">
            <label className="form-label">Số điện thoại</label>
            <div className="settings-phone-row">
              <input
                type="tel"
                className="form-input"
                value={maskPhone(displayPhone)}
                readOnly
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setShowPhoneModal(true);
                  setPhoneStep('input');
                  setNewPhone('');
                  setPhoneOtp('');
                  setDevOtp(null);
                }}
              >
                Đổi SĐT
              </button>
            </div>
            <p className="form-hint">
              SĐT dùng nhận thông báo Zalo
              {user?.phoneVerified ? ' (đã xác thực)' : ' (chưa xác thực)'}.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={savingProfile}
            onClick={handleSaveProfile}
          >
            {savingProfile ? 'Đang lưu...' : '💾 Lưu thay đổi'}
          </button>
        </div>

        {/* Ví nạp trước */}
        <div className="card settings-card">
          <div className="card-header">💰 VÍ NẠP TRƯỚC</div>
          <div className="wallet-card">
            <div className="wallet-info">
              <div className="wallet-balance">{formatVnd(walletBalance)}</div>
              <div className="wallet-hint">Số dư tự động dùng để gia hạn gói khi đến hạn.</div>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setShowTopupModal(true)}>
              ⚡ Nạp thêm
            </button>
          </div>
          <div className="wallet-topup-hints">
            {WALLET_RENEW_HINTS.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>

          {transactions.length > 0 && (
            <div className="wallet-history">
              <div className="wallet-history-head">
                <span>Giao dịch gần đây</span>
                <Link href={routes.dashboardWallet} className="settings-link">
                  Xem tất cả →
                </Link>
              </div>
              <ul className="wallet-history-list">
                {transactions.map((tx) => (
                  <li key={tx.id}>
                    <span>{tx.description ?? tx.type}</span>
                    <span className={tx.type === 'topup' ? 'text-green' : ''}>
                      {tx.type === 'payment' ? '-' : '+'}
                      {formatVnd(Number(tx.amount))}
                    </span>
                    <span className="text-muted">{formatDate(tx.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Gia hạn tự động (Combo) / Auto Top-up (Hourly) */}
        {billingType === 'combo' && (() => {
          const renewMethod = userSettings.autoRenewMethod || 'wallet';
          const renewPrice = userSettings.autoRenewPreview?.renewPrice ?? 0;
          const balanceForRenew =
            userSettings.autoRenewPreview?.walletBalance ?? walletBalance;
          const walletSufficient = renewPrice <= 0 || balanceForRenew >= renewPrice;
          const threshold = userSettings.autoRenewThreshold ?? 10;
          const thresholdOptions = [5, 10, 15, 20];

          return (
            <div className="card settings-card auto-renew-card">
              <div className="card-header">🔄 Gia hạn tự động</div>

              <ToggleRow
                label="Bật gia hạn tự động"
                desc="Tự động tái tục gói Combo khi giờ còn lại dưới ngưỡng"
                checked={userSettings.autoRenewEnabled}
                disabled={savingSettings}
                onChange={(v) => saveUserSettings({ autoRenewEnabled: v })}
              />

              <div className="settings-auto-renew-threshold">
                <label htmlFor="autoRenewThreshold">
                  Còn{' '}
                  <select
                    id="autoRenewThreshold"
                    value={threshold}
                    disabled={savingSettings}
                    onChange={(e) =>
                      saveUserSettings({ autoRenewThreshold: Number(e.target.value) })
                    }
                  >
                    {thresholdOptions.map((h) => (
                      <option key={h} value={h}>
                        {h}h
                      </option>
                    ))}
                  </select>{' '}
                  thì tự động gia hạn
                </label>
              </div>

              <div className="auto-renew-options">
                <label
                  className={`auto-renew-radio${renewMethod === 'wallet' ? ' is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="autoRenewMethod"
                    checked={renewMethod === 'wallet'}
                    disabled={savingSettings}
                    onChange={() =>
                      saveUserSettings({ autoRenewMethod: 'wallet', autoRenewEnabled: true })
                    }
                  />
                  <div className="auto-renew-radio-body">
                    <div className="auto-renew-radio-title">
                      Ví nạp trước
                      {renewMethod === 'wallet' && (
                        <span
                          className={`auto-renew-wallet-inline${walletSufficient ? ' ok' : ' low'}`}
                        >
                          {' '}
                          · Số dư: {formatVnd(balanceForRenew)}
                        </span>
                      )}
                    </div>
                  </div>
                </label>

                <label
                  className={`auto-renew-radio${renewMethod === 'transfer' ? ' is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="autoRenewMethod"
                    checked={renewMethod === 'transfer'}
                    disabled={savingSettings}
                    onChange={() =>
                      saveUserSettings({ autoRenewMethod: 'transfer', autoRenewEnabled: true })
                    }
                  />
                  <div className="auto-renew-radio-body">
                    <div className="auto-renew-radio-title">Chuyển khoản thủ công</div>
                    {renewMethod === 'transfer' && (
                      <p className="auto-renew-transfer-hint">
                        Bạn sẽ nhận thông báo khi sắp hết giờ
                      </p>
                    )}
                  </div>
                </label>
              </div>

              <p className="auto-renew-bonus-line">
                🎁 Bật gia hạn tự động: tặng thêm 3% giờ mỗi lần tái tục
              </p>
              <p className="auto-renew-bonus-line hint">
                💡 Tái tục chủ động khi còn &gt;10h được tặng 5% giờ
              </p>

              <div className="auto-renew-divider" />

              <div className="auto-renew-note">
                <strong>📌 Lưu ý:</strong>
                <ul>
                  <li>Chỉ áp dụng cho gói Combo 1 &amp; Combo 2</li>
                  <li>Hệ thống chỉ gia hạn khi số dư Ví ≥ số tiền cần để tái tục</li>
                </ul>
              </div>
            </div>
          );
        })()}

        {/* Thông báo */}
        <div className="card settings-card">
          <div className="card-header">🔔 THÔNG BÁO</div>
          <ToggleRow
            label="Zalo"
            checked={notifications.zaloEnabled}
            disabled={savingSettings}
            onChange={(v) => saveNotifications({ zaloEnabled: v })}
          />
          <ToggleRow
            label="Email"
            checked={notifications.emailEnabled}
            disabled={savingSettings}
            onChange={(v) => saveNotifications({ emailEnabled: v })}
          />
          <p className="settings-events-label">Thông báo khi:</p>
          <ToggleRow
            label="Sắp hết giờ"
            desc="Khi còn dưới 10% giờ"
            checked={notifications.eventLowHours}
            disabled={savingSettings}
            onChange={(v) => saveNotifications({ eventLowHours: v })}
          />
          <ToggleRow
            label="Sắp hết hạn gói"
            desc="Trước 3 ngày"
            checked={notifications.eventExpiring}
            disabled={savingSettings}
            onChange={(v) => saveNotifications({ eventExpiring: v })}
          />
          <ToggleRow
            label="Backup đầy"
            checked={notifications.eventBackupFull}
            disabled={savingSettings}
            onChange={(v) => saveNotifications({ eventBackupFull: v })}
          />
          <ToggleRow
            label="Thanh toán thành công"
            checked={notifications.eventPaymentSuccess}
            disabled={savingSettings}
            onChange={(v) => saveNotifications({ eventPaymentSuccess: v })}
          />
        </div>

        {/* Giao diện */}
        <div className="card settings-card">
          <div className="card-header">🎨 GIAO DIỆN</div>
          <div className="form-group">
            <label className="form-label">Chủ đề</label>
            <div className="radio-group">
              <label className="radio-option">
                <input
                  type="radio"
                  name="theme"
                  checked={userSettings.theme === 'light'}
                  disabled={savingSettings}
                  onChange={() => saveUserSettings({ theme: 'light' })}
                />
                ☀️ Sáng
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="theme"
                  checked={userSettings.theme === 'dark'}
                  disabled={savingSettings}
                  onChange={() => saveUserSettings({ theme: 'dark' })}
                />
                🌙 Tối
              </label>
            </div>
          </div>
        </div>

        {/* Bảo mật */}
        <div className="card settings-card settings-card-warn">
          <div className="card-header">🔒 BẢO MẬT</div>
          <div className="settings-action-stack">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowPasswordModal(true)}
            >
              🔒 Đổi mật khẩu
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleSignOutAll}>
              Đăng xuất tất cả thiết bị
            </button>
          </div>
        </div>

        {/* Dữ liệu */}
        <div className="card settings-card settings-card-warn">
          <div className="card-header">🗑️ DỮ LIỆU</div>
          <p className="settings-danger-text">
            Xóa toàn bộ dữ liệu trên Backup. SSD và tài khoản không bị ảnh hưởng.
          </p>
          <p className="settings-danger-alert">⚠️ Hành động này không thể hoàn tác</p>
          <button type="button" className="btn btn-danger" onClick={() => setShowDeleteModal(true)}>
            🗑️ Xóa tất cả Backup
          </button>
        </div>
      </div>

      {/* Modal nạp ví */}
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
          {token ? (
            <WalletDepositForm
              accessToken={token}
              onStepChange={setDepositStep}
              onClose={() => {
                setDepositStep('amount');
                setShowTopupModal(false);
              }}
              onSubmitted={() => void loadExtras()}
              onError={(message) => alert(message)}
            />
          ) : null}
        </div>
      </div>

      {/* Modal đổi mật khẩu */}
      <div
        className={`modal-overlay${showPasswordModal ? ' active' : ''}`}
        onClick={(e) => e.target === e.currentTarget && !passwordBusy && setShowPasswordModal(false)}
        role="presentation"
      >
        <div className="modal" role="dialog" aria-modal="true">
          <button type="button" className="close-btn" onClick={() => setShowPasswordModal(false)}>
            ✕
          </button>
          <h3>🔒 Đổi mật khẩu</h3>
          <div className="form-group">
            <label className="form-label">Mật khẩu cũ</label>
            <input
              type="password"
              className="form-input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Mật khẩu mới</label>
            <input
              type="password"
              className="form-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <p className="form-hint">Tối thiểu 8 ký tự, có chữ hoa và số.</p>
          </div>
          <div className="form-group">
            <label className="form-label">Xác nhận mật khẩu mới</label>
            <input
              type="password"
              className="form-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <div className="btn-group">
            <button type="button" className="btn btn-secondary" onClick={() => setShowPasswordModal(false)}>
              Hủy
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={passwordBusy}
              onClick={handleChangePassword}
            >
              {passwordBusy ? 'Đang xử lý...' : 'Lưu mật khẩu'}
            </button>
          </div>
        </div>
      </div>

      {/* Modal đổi SĐT */}
      <div
        className={`modal-overlay${showPhoneModal ? ' active' : ''}`}
        onClick={(e) => e.target === e.currentTarget && !phoneBusy && setShowPhoneModal(false)}
        role="presentation"
      >
        <div className="modal" role="dialog" aria-modal="true">
          <button type="button" className="close-btn" onClick={() => setShowPhoneModal(false)}>
            ✕
          </button>
          <h3>📱 Đổi số điện thoại</h3>
          {phoneStep === 'input' ? (
            <>
              <div className="form-group">
                <label className="form-label">Số điện thoại mới</label>
                <input
                  type="tel"
                  className="form-input"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="09xxxxxxxx"
                />
              </div>
              <div className="btn-group">
                <button type="button" className="btn btn-secondary" onClick={() => setShowPhoneModal(false)}>
                  Hủy
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={phoneBusy}
                  onClick={handleSendPhoneOtp}
                >
                  {phoneBusy ? 'Đang gửi...' : 'Gửi OTP'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="modal-subtitle">Nhập mã OTP gửi đến {newPhone}</p>
              {devOtp && (
                <p className="form-hint" style={{ color: 'var(--accent-orange)' }}>
                  Dev OTP: {devOtp}
                </p>
              )}
              <div className="form-group">
                <label className="form-label">Mã OTP</label>
                <input
                  type="text"
                  className="form-input"
                  value={phoneOtp}
                  onChange={(e) => setPhoneOtp(e.target.value)}
                  maxLength={6}
                  inputMode="numeric"
                />
              </div>
              <div className="btn-group">
                <button type="button" className="btn btn-secondary" onClick={() => setPhoneStep('input')}>
                  Quay lại
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={phoneBusy}
                  onClick={handleVerifyPhone}
                >
                  {phoneBusy ? 'Đang xác nhận...' : 'Xác nhận'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal xóa backup */}
      <div
        className={`modal-overlay${showDeleteModal ? ' active' : ''}`}
        onClick={(e) => e.target === e.currentTarget && !deleteBusy && setShowDeleteModal(false)}
        role="presentation"
      >
        <div className="modal" role="dialog" aria-modal="true">
          <button type="button" className="close-btn" onClick={() => setShowDeleteModal(false)}>
            ✕
          </button>
          <h3>🗑️ Xóa toàn bộ Backup</h3>
          <p className="settings-danger-alert">⚠️ Hành động này không thể hoàn tác</p>
          <p className="modal-subtitle">Nhập chữ <strong>XÓA</strong> để xác nhận.</p>
          <div className="form-group">
            <input
              type="text"
              className="form-input"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="XÓA"
            />
          </div>
          <div className="btn-group">
            <button type="button" className="btn btn-secondary" onClick={() => setShowDeleteModal(false)}>
              Hủy
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={deleteBusy || deleteConfirm !== 'XÓA'}
              onClick={handleDeleteBackup}
            >
              {deleteBusy ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className="settings-toast" role="status">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
