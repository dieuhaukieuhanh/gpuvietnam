import { routes } from './routes';

export const publicNavItems = [
  { label: 'Hạ tầng', href: `${routes.home}#infrastructure` },
  { label: 'Nhu cầu', href: `${routes.home}#workstations` },
  { label: '📋 Bảng giá', href: routes.bangGia },
  { label: 'FAQ', href: `${routes.home}#faq` },
] as const;

export const footerLinks = [
  { label: 'Hạ tầng', href: `${routes.home}#infrastructure` },
  { label: 'Nhu cầu', href: `${routes.home}#workstations` },
  { label: 'Bảng giá', href: routes.bangGia },
  { label: 'Cách hoạt động', href: `${routes.home}#how-it-works` },
  { label: 'FAQ', href: `${routes.home}#faq` },
  { label: 'Blog', href: '#' },
  { label: 'Liên hệ', href: '#' },
  { label: 'Chính sách bảo mật', href: routes.chinhSach },
] as const;

export const dashboardNavItems = [
  { label: 'Tổng quan', href: routes.dashboard, icon: '📊' },
  { label: 'Cài đặt', href: routes.dashboardCaiDat, icon: '⚙️' },
  { label: 'Lịch sử', href: routes.dashboardLichSu, icon: '📋' },
] as const;

export const adminNavItems = [
  { label: 'Tổng quan', href: routes.admin, icon: '📊' },
  { label: 'Khách hàng', href: routes.adminKhachHang, icon: '👥' },
  { label: 'Hạ tầng GPU', href: routes.adminHaTang, icon: '🖥️' },
  { label: 'Tài nguyên', href: routes.taiNguyen, icon: '📦' },
] as const;

export function scrollToSection(id: string): void {
  if (typeof window === 'undefined') return;
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}
