import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import {
  notifySupportSessionChanged,
  parseSupportSessionId,
} from '@/components/dashboard/DashboardSupportCard';

export type NotificationItem = {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

type NotificationDropdownProps = {
  items: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  markingAll: boolean;
  accessToken: string;
  onMarkAllRead: () => void;
  onMarkRead: (id: number) => void;
  onClose: () => void;
  onRefresh: () => void;
};

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN');
}

function SupportNotificationRow({
  item,
  accessToken,
  onMarkRead,
  onRefresh,
}: {
  item: NotificationItem;
  accessToken: string;
  onMarkRead: (id: number) => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const sessionId = parseSupportSessionId(item.link);
  const timeLabel = formatRelativeTime(item.created_at);

  const runAction = async (action: 'approve' | 'reject') => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/support/${action}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Không xử lý được yêu cầu.');
      if (!item.is_read) onMarkRead(item.id);
      notifySupportSessionChanged();
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Không xử lý được yêu cầu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`notification-dropdown-item support-notification${item.is_read ? ' read' : ''}`}>
      <div className="notification-dropdown-item-title">{item.title}</div>
      {item.message && (
        <div className="notification-dropdown-item-message notification-message-multiline">
          {item.message}
        </div>
      )}
      <div className="notification-dropdown-item-time">{timeLabel}</div>
      {sessionId && !item.is_read && (
        <div className="notification-support-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => void runAction('approve')}
          >
            {busy ? '...' : '✅ Đồng ý'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={busy}
            onClick={() => void runAction('reject')}
          >
            Từ chối
          </button>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  item,
  accessToken,
  onMarkRead,
  onClose,
  onRefresh,
}: {
  item: NotificationItem;
  accessToken: string;
  onMarkRead: (id: number) => void;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const timeLabel = formatRelativeTime(item.created_at);

  if (item.type === 'support_request' && parseSupportSessionId(item.link)) {
    return (
      <SupportNotificationRow
        item={item}
        accessToken={accessToken}
        onMarkRead={onMarkRead}
        onRefresh={onRefresh}
      />
    );
  }

  const handleClick = async () => {
    if (!item.is_read) {
      onMarkRead(item.id);
    }
    onClose();
    if (item.link) {
      await router.push(item.link);
    }
  };

  const content = (
    <>
      <div className="notification-dropdown-item-title">{item.title}</div>
      {item.message && (
        <div className="notification-dropdown-item-message notification-message-multiline">
          {item.message}
        </div>
      )}
      <div className="notification-dropdown-item-time">{timeLabel}</div>
    </>
  );

  if (item.link) {
    return (
      <Link
        href={item.link}
        className={`notification-dropdown-item${item.is_read ? ' read' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          void handleClick();
        }}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={`notification-dropdown-item${item.is_read ? ' read' : ''}`}
      onClick={() => void handleClick()}
    >
      {content}
    </button>
  );
}

export default function NotificationDropdown({
  items,
  unreadCount,
  loading,
  markingAll,
  accessToken,
  onMarkAllRead,
  onMarkRead,
  onClose,
  onRefresh,
}: NotificationDropdownProps) {
  const unreadItems = items.filter((item) => !item.is_read);
  const readItems = items.filter((item) => item.is_read);

  return (
    <div className="notification-dropdown-panel">
      <div className="notification-dropdown-head">
        <span className="notification-dropdown-head-title">🔔 Thông báo</span>
      </div>

      {loading ? (
        <div className="notification-dropdown-empty">Đang tải...</div>
      ) : items.length === 0 ? (
        <div className="notification-dropdown-empty">Chưa có thông báo nào.</div>
      ) : (
        <div className="notification-dropdown-body">
          {unreadItems.length > 0 && (
            <section className="notification-dropdown-section">
              <div className="notification-dropdown-section-title">
                🔴 Mới ({unreadCount})
              </div>
              <div className="notification-dropdown-list">
                {unreadItems.map((item) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    accessToken={accessToken}
                    onMarkRead={onMarkRead}
                    onClose={onClose}
                    onRefresh={onRefresh}
                  />
                ))}
              </div>
            </section>
          )}

          {readItems.length > 0 && (
            <section className="notification-dropdown-section">
              <div className="notification-dropdown-section-title muted">Đã đọc</div>
              <div className="notification-dropdown-list">
                {readItems.map((item) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    accessToken={accessToken}
                    onMarkRead={onMarkRead}
                    onClose={onClose}
                    onRefresh={onRefresh}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <div className="notification-dropdown-footer">
        <button
          type="button"
          className="notification-dropdown-mark-all"
          disabled={markingAll || unreadCount === 0}
          onClick={onMarkAllRead}
        >
          {markingAll ? 'Đang cập nhật...' : 'Đánh dấu đọc tất cả'}
        </button>
      </div>
    </div>
  );
}
