import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import NotificationDropdown, { type NotificationItem } from '@/components/dashboard/NotificationDropdown';

const POLL_INTERVAL_MS = 30_000;

export default function NotificationBell() {
  const { session } = useAuth();
  const rootRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const token = session?.access_token ?? '';

  const fetchUnreadCount = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/user/notifications/unread-count', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setUnreadCount(data.count ?? 0);
      }
    } catch {
      /* optional polling */
    }
  }, [token]);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    setLoadingList(true);
    try {
      const res = await fetch('/api/user/notifications?limit=10&offset=0', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setItems(data.items ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      }
    } finally {
      setLoadingList(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchUnreadCount();
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (!token) return undefined;
    const id = window.setInterval(() => {
      void fetchUnreadCount();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [token, fetchUnreadCount]);

  useEffect(() => {
    if (open) {
      void fetchNotifications();
    }
  }, [open, fetchNotifications]);

  useEffect(() => {
    const handleOpen = () => {
      setOpen(true);
      void fetchNotifications();
    };
    window.addEventListener('dashboard-open-notifications', handleOpen);
    return () => window.removeEventListener('dashboard-open-notifications', handleOpen);
  }, [fetchNotifications]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const markRead = useCallback(
    async (id: number) => {
      if (!token) return;
      try {
        const res = await fetch('/api/user/notifications/read', {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id }),
        });
        if (res.ok) {
          setItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, is_read: true } : item)),
          );
          setUnreadCount((count) => Math.max(0, count - 1));
        }
      } catch {
        /* ignore */
      }
    },
    [token],
  );

  const markAllRead = useCallback(async () => {
    if (!token || unreadCount === 0) return;
    setMarkingAll(true);
    try {
      const res = await fetch('/api/user/notifications/read', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ all: true }),
      });
      if (res.ok) {
        setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
        setUnreadCount(0);
      }
    } finally {
      setMarkingAll(false);
    }
  }, [token, unreadCount]);

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div className="notification-bell-wrap" ref={rootRef}>
      <button
        type="button"
        className={`notification-bell-trigger${open ? ' open' : ''}`}
        aria-label={`Thông báo${unreadCount > 0 ? `, ${unreadCount} chưa đọc` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="notification-bell-icon">🔔</span>
        {unreadCount > 0 && <span className="notification-bell-badge">{badgeLabel}</span>}
      </button>

      {open && (
        <NotificationDropdown
          items={items}
          unreadCount={unreadCount}
          loading={loadingList}
          markingAll={markingAll}
          accessToken={token}
          onMarkAllRead={() => void markAllRead()}
          onMarkRead={(id) => void markRead(id)}
          onClose={() => setOpen(false)}
          onRefresh={() => void fetchNotifications()}
        />
      )}
    </div>
  );
}
