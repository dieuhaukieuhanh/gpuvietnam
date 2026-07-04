import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { useAuth } from '@/contexts/AuthContext';
import {
  ADMIN_HEADER_MENU,
  adminPanelUrl,
  type AdminHeaderMenuEntry,
} from '@/lib/admin-nav';
import { adminFetch } from '@/lib/admin-session';
import { routes } from '@/lib/routes';

const PENDING_POLL_MS = 30_000;

function getDisplayName(user: User): string {
  const fullName = user.user_metadata?.full_name;
  if (typeof fullName === 'string' && fullName.trim()) return fullName.trim();
  if (user.email) return user.email.split('@')[0];
  const phone = user.user_metadata?.phone;
  if (typeof phone === 'string' && phone.trim()) return phone.trim();
  return 'Tài khoản';
}

type CustomerMenuProps = {
  onClose: () => void;
  onSignOut: () => void;
};

function CustomerMenu({ onClose, onSignOut }: CustomerMenuProps) {
  return (
    <>
      <Link href={routes.dashboard} className="user-menu-item" role="menuitem" onClick={onClose}>
        <span aria-hidden>👤</span> Dashboard
      </Link>
      <Link
        href={routes.dashboardCaiDat}
        className="user-menu-item"
        role="menuitem"
        onClick={onClose}
      >
        <span aria-hidden>⚙️</span> Cài đặt
      </Link>
      <Link
        href={routes.dashboardStorage}
        className="user-menu-item"
        role="menuitem"
        onClick={onClose}
      >
        <span aria-hidden>💾</span> Bộ nhớ
      </Link>
      <div className="user-menu-divider" role="separator" />
      <button type="button" className="user-menu-item danger" role="menuitem" onClick={onSignOut}>
        <span aria-hidden>🚪</span> Đăng xuất
      </button>
    </>
  );
}

type AdminMenuProps = {
  pendingCount: number;
  onClose: () => void;
  onSignOut: () => void;
};

function renderAdminEntry(
  entry: AdminHeaderMenuEntry,
  pendingCount: number,
  onClose: () => void,
  index: number,
) {
  if (entry.kind === 'divider') {
    return <div key={`div-${index}`} className="user-menu-divider" role="separator" />;
  }

  if (entry.kind === 'heading') {
    return (
      <div key={`head-${index}`} className="user-menu-section-label">
        {entry.label}
      </div>
    );
  }

  const href = entry.kind === 'tab' ? adminPanelUrl(entry.tab) : entry.href;
  const showBadge = entry.kind === 'tab' && entry.showPendingBadge && pendingCount > 0;

  return (
    <Link
      key={`${entry.kind}-${entry.label}`}
      href={href}
      className="user-menu-item user-menu-item-admin"
      role="menuitem"
      onClick={onClose}
    >
      <span aria-hidden>{entry.icon}</span>
      <span className="user-menu-item-label">{entry.label}</span>
      {showBadge ? <span className="user-menu-pending-badge">{pendingCount}</span> : null}
    </Link>
  );
}

function AdminMenu({ pendingCount, onClose, onSignOut }: AdminMenuProps) {
  return (
    <>
      {ADMIN_HEADER_MENU.map((entry, index) => renderAdminEntry(entry, pendingCount, onClose, index))}
      <div className="user-menu-divider" role="separator" />
      <button type="button" className="user-menu-item danger" role="menuitem" onClick={onSignOut}>
        <span aria-hidden>🚪</span> Đăng xuất
      </button>
    </>
  );
}

export default function UserMenu() {
  const router = useRouter();
  const { user, isAdmin, roleLoading, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const fetchPendingCount = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await adminFetch('/api/admin/pending-requests/count');
      const data = await res.json();
      if (res.ok) setPendingCount(data.count ?? 0);
    } catch {
      /* optional badge */
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setPendingCount(0);
      return undefined;
    }

    fetchPendingCount();
    const id = window.setInterval(fetchPendingCount, PENDING_POLL_MS);
    return () => window.clearInterval(id);
  }, [isAdmin, fetchPendingCount]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        close();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, close]);

  const handleSignOut = async () => {
    close();
    await signOut();
    router.push(routes.home);
  };

  if (!user) return null;

  const displayName = getDisplayName(user);

  if (roleLoading) {
    return (
      <div className="user-menu">
        <button type="button" className="user-menu-trigger" disabled aria-busy="true">
          <span className="user-menu-avatar" aria-hidden>
            ⋯
          </span>
          <span className="user-menu-name">Đang tải...</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`user-menu${isAdmin ? ' user-menu--admin' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`user-menu-trigger${isAdmin ? ' user-menu-trigger--admin' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="user-menu-avatar" aria-hidden>
          {isAdmin ? '🛡️' : '👤'}
        </span>
        <span className="user-menu-name">{displayName}</span>
        {isAdmin ? <span className="user-menu-role-tag">Admin</span> : null}
        {isAdmin && pendingCount > 0 ? (
          <span className="user-menu-trigger-badge" aria-label={`${pendingCount} yêu cầu chờ duyệt`}>
            {pendingCount}
          </span>
        ) : null}
        <span className="user-menu-chevron" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div
          className={`user-menu-dropdown${isAdmin ? ' user-menu-dropdown--admin' : ''}`}
          role="menu"
        >
          {isAdmin ? (
            <AdminMenu pendingCount={pendingCount} onClose={close} onSignOut={handleSignOut} />
          ) : (
            <CustomerMenu onClose={close} onSignOut={handleSignOut} />
          )}
        </div>
      )}
    </div>
  );
}
