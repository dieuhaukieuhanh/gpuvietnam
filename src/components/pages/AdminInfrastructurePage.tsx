import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import AdminAuthGate from '@/components/admin/AdminAuthGate';
import AdminInfrastructurePanel from '@/components/admin/AdminInfrastructurePanel';
import AdminReconciliationPanel from '@/components/admin/AdminReconciliationPanel';
import AdminHostIntelligencePanel from '@/components/admin/AdminHostIntelligencePanel';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminMobileShell } from '@/hooks/useAdminMobileShell';
import {
  ADMIN_PLACEHOLDER_TABS,
  ADMIN_TAB_TITLES,
  adminPanelUrl,
  adminTabIcon,
} from '@/lib/admin-nav';
import { adminFetch, clearAdminSecret } from '@/lib/admin-session';
import { routes } from '@/lib/routes';
import { styles } from '@/styles/pages/admin-panel.styles';

const PENDING_COUNT_INTERVAL_MS = 30_000;

export default function AdminInfrastructurePage() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { closeSidebar, toggleSidebar, shellClass } = useAdminMobileShell();
  const [pendingCount, setPendingCount] = useState(0);
  const [authKey, setAuthKey] = useState(0);

  const fetchPendingCount = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/pending-requests/count');
      const data = await res.json();
      if (res.ok) {
        setPendingCount(data.count ?? 0);
      }
    } catch {
      /* badge optional */
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

  const goTab = (href: string) => {
    closeSidebar();
    router.push(href);
  };

  return (
    <>
      <Head>
        <title>GPU Vietnam – Hạ tầng GPU</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
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
            <button type="button" onClick={() => goTab(adminPanelUrl('requests'))}>
              <span>📋</span>
              <span>
                Duyệt yêu cầu
                {pendingCount > 0 ? ` (${pendingCount})` : ''}
              </span>
              {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
            </button>
            <button type="button" onClick={() => goTab(adminPanelUrl('storagePricing'))}>
              <span>📊</span>
              <span>Giá bộ nhớ</span>
            </button>
            <button type="button" className="active">
              <span>🏗️</span>
              <span>Hạ tầng</span>
            </button>
            <button type="button" onClick={() => goTab(routes.adminCustomers)}>
              <span>👥</span>
              <span>Khách hàng</span>
            </button>
            <button type="button" onClick={() => goTab(adminPanelUrl('gpuPricing'))}>
              <span>💳</span>
              <span>Edit giá</span>
            </button>
            {ADMIN_PLACEHOLDER_TABS.map((tab) => (
              <button key={tab} type="button" onClick={() => goTab(adminPanelUrl(tab))}>
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
                onClick={toggleSidebar}
              >
                ☰
              </button>
              <h2>🏗️ Hạ tầng GPU</h2>
            </div>
            <div className="right">
              <span className="clock" id="clock">
                --:--:--
              </span>
            </div>
          </header>

          <div className="content">
            <AdminInfrastructurePanel />
            <AdminReconciliationPanel />
            <AdminHostIntelligencePanel />
          </div>
        </div>
        </div>
      </AdminAuthGate>
    </>
  );
}
