import Link from 'next/link';
import { brand } from '@/lib/constants';
import { dashboardNavItems } from '@/lib/navigation';

type DashboardSidebarProps = {
  activeHref?: string;
};

export default function DashboardSidebar({ activeHref }: DashboardSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Link href="/dashboard" className="logo">
          <div className="logo-icon">{brand.icon}</div>
          {brand.name}
        </Link>
      </div>
      <nav className="sidebar-nav">
        {dashboardNavItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-link${activeHref === item.href ? ' active' : ''}`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
