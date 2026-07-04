import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import AdminAuthGate from '@/components/admin/AdminAuthGate';
import AdminGpuPricingPanel from '@/components/admin/AdminGpuPricingPanel';
import AdminPendingRequestsPanel from '@/components/admin/AdminPendingRequestsPanel';
import AdminHourGrantsPanel from '@/components/admin/AdminHourGrantsPanel';
import AdminStoragePricingPanel from '@/components/admin/AdminStoragePricingPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminMobileShell } from '@/hooks/useAdminMobileShell';
import {
  ADMIN_PLACEHOLDER_TABS,
  ADMIN_TAB_TITLES,
  adminPanelUrl,
  adminTabIcon,
  isAdminTab,
  type AdminTab,
} from '@/lib/admin-nav';
import { adminFetch, clearAdminSecret } from '@/lib/admin-session';
import { routes } from '@/lib/routes';
import { styles as hourGrantsStyles } from '@/styles/pages/admin-hour-grants.styles';
import { styles } from '@/styles/pages/admin-panel.styles';

const PENDING_COUNT_INTERVAL_MS = 30_000;

export default function AdminPanelPage() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { closeSidebar, toggleSidebar, shellClass } = useAdminMobileShell();
  const [activeTab, setActiveTab] = useState<AdminTab>('requests');
  const [pendingCount, setPendingCount] = useState(0);
  const [authKey, setAuthKey] = useState(0);

  useEffect(() => {
    if (!router.isReady) return;
    const tabQuery = router.query.tab;
    if (typeof tabQuery === 'string' && isAdminTab(tabQuery)) {
      setActiveTab(tabQuery);
    }
  }, [router.isReady, router.query.tab]);

  const navigateTab = useCallback(
    (tab: AdminTab) => {
      setActiveTab(tab);
      closeSidebar();
      router.replace(adminPanelUrl(tab), undefined, { shallow: true });
    },
    [router, closeSidebar],
  );

  const fetchPendingCount = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/pending-requests/count');
      const data = await res.json();
      if (res.ok) {
        setPendingCount(data.count ?? 0);
      }
    } catch {
      /* badge optional — ignore network errors */
    }
  }, []);

  const updateClock = useCallback(() => {
    const el = document.getElementById('clock');
    if (el) {
      el.textContent = new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
  }, []);

  useEffect(() => {
    updateClock();
    const id = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(id);
  }, [updateClock]);

  useEffect(() => {
    fetchPendingCount();
    const id = window.setInterval(fetchPendingCount, PENDING_COUNT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [fetchPendingCount, authKey]);

  const handleLogout = async () => {
    clearAdminSecret();
    await signOut().catch(() => undefined);
    setAuthKey((k) => k + 1);
  };

  return (
    <>
      <Head>
        <title>GPU Vietnam – Admin</title>
        <style dangerouslySetInnerHTML={{ __html: styles + hourGrantsStyles }} />
      </Head>

      <AdminAuthGate key={authKey}>
        <div className={shellClass}>
          <button
            type="button"
            className="admin-sidebar-backdrop"
            aria-label="Đóng menu"
            tabIndex={-1}
            onClick={closeSidebar}
          />
          <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="logo">GPU</div>
            <div>
              <h1>
                GPU<span>Vietnam</span>
              </h1>
              <small>Admin</small>
            </div>
          </div>
          <nav className="sidebar-nav">
            <button
              type="button"
              className={activeTab === 'requests' ? 'active' : ''}
              onClick={() => navigateTab('requests')}
            >
              <span>📋</span>
              <span>
                Duyệt yêu cầu
                {pendingCount > 0 ? ` (${pendingCount})` : ''}
              </span>
              {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
            </button>
            <button
              type="button"
              className={activeTab === 'storagePricing' ? 'active' : ''}
              onClick={() => navigateTab('storagePricing')}
            >
              <span>📊</span>
              <span>Giá bộ nhớ</span>
            </button>
            <button
              type="button"
              className={activeTab === 'hourGrants' ? 'active' : ''}
              onClick={() => navigateTab('hourGrants')}
            >
              <span>🎁</span>
              <span>Tặng giờ</span>
            </button>
            <button type="button" onClick={() => { closeSidebar(); router.push(routes.adminInfrastructure); }}>
              <span>🏗️</span>
              <span>Hạ tầng</span>
            </button>
            <button type="button" onClick={() => { closeSidebar(); router.push(routes.adminCustomers); }}>
              <span>👥</span>
              <span>Khách hàng</span>
            </button>
            <button
              type="button"
              className={activeTab === 'gpuPricing' ? 'active' : ''}
              onClick={() => navigateTab('gpuPricing')}
            >
              <span>💳</span>
              <span>Edit giá</span>
            </button>
            {ADMIN_PLACEHOLDER_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                className={activeTab === tab ? 'active' : ''}
                onClick={() => navigateTab(tab)}
              >
                <span>{adminTabIcon(tab)}</span>
                <span>{ADMIN_TAB_TITLES[tab]}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="avatar">A</div>
            <div className="info">
              <p>Admin</p>
              <small>gpuvietnam.com</small>
            </div>
            <button type="button" onClick={handleLogout} title="Đăng xuất">
              ↪
            </button>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <div className="topbar-left">
              <button
                type="button"
                className="admin-menu-toggle"
                aria-label="Mở menu Admin"
                aria-expanded={false}
                onClick={toggleSidebar}
              >
                ☰
              </button>
              <h2>{ADMIN_TAB_TITLES[activeTab]}</h2>
            </div>
            <div className="right">
              <span className="clock" id="clock">
                --:--:--
              </span>
              {activeTab === 'requests' && pendingCount > 0 && (
                <span className="live-badge">
                  <span className="dot" />
                  <span className="live-badge-text-full">{pendingCount} yêu cầu chờ duyệt</span>
                  <span className="live-badge-text-short">{pendingCount} chờ</span>
                </span>
              )}
            </div>
          </header>

          <div className="content">
            {activeTab === 'requests' ? (
              <AdminPendingRequestsPanel onCountChange={setPendingCount} />
            ) : activeTab === 'storagePricing' ? (
              <AdminStoragePricingPanel />
            ) : activeTab === 'hourGrants' ? (
              <AdminHourGrantsPanel />
            ) : activeTab === 'gpuPricing' ? (
              <AdminGpuPricingPanel />
            ) : (
              <div className="card">
                <p className="text-muted">
                  Mục này đang phát triển. Hiện tại dùng tab Duyệt yêu cầu.
                </p>
              </div>
            )}
          </div>
        </div>
        </div>
      </AdminAuthGate>
    </>
  );
}
