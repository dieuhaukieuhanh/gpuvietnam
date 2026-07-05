import Link from 'next/link';
import { useRouter } from 'next/router';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import NotificationBell from '@/components/dashboard/NotificationBell';
import WalletDropdown from '@/components/dashboard/WalletDropdown';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { routes } from '@/lib/routes';
import type { DashboardUser } from '@/hooks/useDashboard';

type DashboardShellProps = {
  children: ReactNode;
  user: DashboardUser | null;
  activeTab?: 'dashboard' | 'myPlan' | 'settings' | 'history' | 'models' | 'workflows' | 'storage' | 'wallet';
  title?: string;
  mainClassName?: string;
};

const BOTTOM_NAV = [
  { key: 'dashboard' as const, href: routes.dashboard, icon: '🏠', label: 'Trung tâm' },
  { key: 'myPlan' as const, href: routes.dashboardGoiCuaToi, icon: '📦', label: 'Gói của tôi' },
  { key: 'wallet' as const, href: routes.dashboardWallet, icon: '💰', label: 'Ví nạp trước' },
  { key: 'notifications' as const, href: routes.dashboard, icon: '🔔', label: 'Thông báo' },
];

export default function DashboardShell({
  children,
  user,
  activeTab = 'dashboard',
  title = 'Dashboard',
  mainClassName = 'main-content',
}: DashboardShellProps) {
  const router = useRouter();
  const { signOut } = useAuth();
  const { isMobile, isTablet } = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);

  useEffect(() => {
    if (!isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSidebar();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeSidebar, sidebarOpen]);

  const handleLogout = async () => {
    await signOut();
    router.push(routes.login);
  };

  const handleBottomNav = (key: (typeof BOTTOM_NAV)[number]['key']) => {
    if (key === 'notifications') {
      window.dispatchEvent(new CustomEvent('dashboard-open-notifications'));
      return;
    }
    closeSidebar();
  };

  const displayName = user?.displayName ?? '...';
  const shellClass = [
    'dashboard-shell',
    isMobile ? 'dashboard-shell--mobile' : '',
    isTablet ? 'dashboard-shell--tablet' : '',
    sidebarOpen ? 'dashboard-shell--sidebar-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const mainClasses = [
    mainClassName,
    isMobile ? 'main-content--mobile-bottom-nav' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={shellClass}>
      {isMobile && sidebarOpen && (
        <button
          type="button"
          className="dashboard-sidebar-backdrop"
          aria-label="Đóng menu"
          onClick={closeSidebar}
        />
      )}

      <aside className="sidebar">
        <Link href={routes.dashboard} className="sidebar-logo" onClick={closeSidebar}>
          <span className="logo-icon">⚡</span>
          <span>GPUVietnam</span>
        </Link>
        <nav className="sidebar-nav">
          <Link
            href={routes.dashboard}
            className={`sidebar-item${activeTab === 'dashboard' ? ' active' : ''}`}
            onClick={closeSidebar}
          >
            <span className="icon">🎛️</span> <span>Dashboard</span>
          </Link>
          <Link
            href={routes.dashboardGoiCuaToi}
            className={`sidebar-item${activeTab === 'myPlan' ? ' active' : ''}`}
            onClick={closeSidebar}
          >
            <span className="icon">📦</span> <span>Gói của tôi</span>
          </Link>
          <div className="sidebar-divider" />
          <Link
            href={routes.dashboardModelLora}
            className={`sidebar-item${activeTab === 'models' ? ' active' : ''}`}
            onClick={closeSidebar}
          >
            <span className="icon">🧩</span> <span>Model & LoRA</span>
          </Link>
          <Link
            href={routes.dashboardWorkflows}
            className={`sidebar-item${activeTab === 'workflows' ? ' active' : ''}`}
            onClick={closeSidebar}
          >
            <span className="icon">📁</span> <span>Workflow</span>
          </Link>
          <Link
            href={routes.dashboardStorage}
            className={`sidebar-item${activeTab === 'storage' ? ' active' : ''}`}
            onClick={closeSidebar}
          >
            <span className="icon">💾</span> <span>Bộ nhớ</span>
          </Link>
          <Link
            href={routes.dashboardLichSu}
            className={`sidebar-item${activeTab === 'history' ? ' active' : ''}`}
            onClick={closeSidebar}
          >
            <span className="icon">📜</span> <span>Lịch sử</span>
          </Link>
          <div className="sidebar-divider" />
          <Link
            href={routes.dashboardWallet}
            className={`sidebar-item${activeTab === 'wallet' ? ' active' : ''}`}
            onClick={closeSidebar}
          >
            <span className="icon">💰</span> <span>Ví nạp trước</span>
          </Link>
          <Link
            href={routes.dashboardCaiDat}
            className={`sidebar-item${activeTab === 'settings' ? ' active' : ''}`}
            onClick={closeSidebar}
          >
            <span className="icon">⚙️</span> <span>Cài đặt</span>
          </Link>
          <div className="sidebar-divider" />
          <button type="button" className="sidebar-item logout" onClick={handleLogout}>
            <span className="icon">🚪</span> <span>Đăng xuất</span>
          </button>
        </nav>
      </aside>

      <header className="header">
        <div className="header-left">
          {isMobile && (
            <button
              type="button"
              className="dashboard-hamburger"
              aria-label="Mở menu"
              aria-expanded={sidebarOpen}
              onClick={toggleSidebar}
            >
              ☰
            </button>
          )}
          <span className="header-greeting-full">
            {title} — Xin chào, <strong>{displayName}</strong>
          </span>
          <span className="header-greeting-short">
            Xin chào, <strong>{displayName}</strong>
          </span>
        </div>
        <div className="header-right">
          {!isMobile && <NotificationBell />}
          {!isMobile && <WalletDropdown />}
          {!isMobile && (
            <Link href={routes.bangGia} className="btn btn-accent">
              ⚡ Nạp giờ
            </Link>
          )}
        </div>
      </header>

      <main className={mainClasses}>{children}</main>

      {isMobile && (
        <div className="dashboard-mobile-notif-host">
          <NotificationBell />
        </div>
      )}

      {isMobile && (
        <nav className="dashboard-bottom-nav" aria-label="Điều hướng chính">
          {BOTTOM_NAV.map((item) => {
            const isActive =
              item.key === 'notifications'
                ? activeTab === 'dashboard'
                : activeTab === item.key;
            if (item.key === 'notifications') {
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`dashboard-bottom-nav-item${isActive ? ' active' : ''}`}
                  onClick={() => handleBottomNav('notifications')}
                >
                  <span className="dashboard-bottom-nav-icon">{item.icon}</span>
                  <span className="dashboard-bottom-nav-label">{item.label}</span>
                </button>
              );
            }
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`dashboard-bottom-nav-item${isActive ? ' active' : ''}`}
                onClick={() => handleBottomNav(item.key)}
              >
                <span className="dashboard-bottom-nav-icon">{item.icon}</span>
                <span className="dashboard-bottom-nav-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
