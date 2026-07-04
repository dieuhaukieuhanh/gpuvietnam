import { routes } from '@/lib/routes';

export const ADMIN_INFRASTRUCTURE_TITLE = 'Hạ tầng GPU';

export type AdminTab =
  | 'requests'
  | 'storagePricing'
  | 'hourGrants'
  | 'gpuPricing'
  | 'overview'
  | 'customers'
  | 'sessions'
  | 'billing';

export const ADMIN_TAB_TITLES: Record<AdminTab, string> = {
  requests: 'Duyệt yêu cầu',
  storagePricing: 'Giá bộ nhớ',
  hourGrants: 'Tặng giờ',
  gpuPricing: 'Edit giá',
  overview: 'Tổng quan',
  customers: 'Khách hàng',
  sessions: 'Phiên GPU',
  billing: 'Doanh thu',
};

export const ADMIN_SIDEBAR_TABS: AdminTab[] = [
  'requests',
  'storagePricing',
  'hourGrants',
  'gpuPricing',
  'overview',
  'customers',
  'sessions',
  'billing',
];

export const ADMIN_PLACEHOLDER_TABS: AdminTab[] = ['overview', 'sessions', 'billing'];

const ADMIN_TAB_SET = new Set<string>(ADMIN_SIDEBAR_TABS);

export function isAdminTab(value: string): value is AdminTab {
  return ADMIN_TAB_SET.has(value);
}

/** URL Admin panel — tab mặc định `requests` không cần query. */
export function adminPanelUrl(tab: AdminTab = 'requests'): string {
  if (tab === 'requests') return routes.admin;
  return `${routes.admin}?tab=${encodeURIComponent(tab)}`;
}

export type AdminHeaderMenuEntry =
  | { kind: 'heading'; label: string }
  | { kind: 'tab'; tab: AdminTab; label: string; icon: string; showPendingBadge?: boolean }
  | { kind: 'link'; href: string; label: string; icon: string }
  | { kind: 'divider' };

/** Mục menu header công khai khi đăng nhập bằng Admin. */
export const ADMIN_HEADER_MENU: AdminHeaderMenuEntry[] = [
  { kind: 'link', href: routes.admin, label: 'Admin Panel', icon: '🛡️' },
  { kind: 'divider' },
  { kind: 'heading', label: 'Quản lý' },
  {
    kind: 'tab',
    tab: 'requests',
    label: 'Duyệt yêu cầu',
    icon: '📋',
    showPendingBadge: true,
  },
  { kind: 'tab', tab: 'gpuPricing', label: 'Edit giá GPU', icon: '💳' },
  { kind: 'tab', tab: 'storagePricing', label: 'Giá bộ nhớ', icon: '📊' },
  { kind: 'tab', tab: 'hourGrants', label: 'Tặng giờ', icon: '🎁' },
  { kind: 'link', href: routes.adminInfrastructure, label: 'Hạ tầng GPU', icon: '🏗️' },
  { kind: 'link', href: routes.adminCustomers, label: 'Khách hàng', icon: '👥' },
  { kind: 'divider' },
  { kind: 'heading', label: 'Xem site' },
  { kind: 'link', href: routes.home, label: 'Trang chủ', icon: '🏠' },
  { kind: 'link', href: routes.bangGia, label: 'Bảng giá công khai', icon: '💰' },
];

export function adminTabIcon(tab: AdminTab): string {
  if (tab === 'requests') return '📋';
  if (tab === 'storagePricing') return '📊';
  if (tab === 'hourGrants') return '🎁';
  if (tab === 'gpuPricing') return '💳';
  if (tab === 'overview') return '📊';
  if (tab === 'customers') return '👥';
  if (tab === 'sessions') return '⚡';
  return '💰';
}
