import { useCallback, useEffect, useState } from 'react';

export function useAdminMobileShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);

  useEffect(() => {
    if (!sidebarOpen) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSidebar();
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [sidebarOpen, closeSidebar]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 768) closeSidebar();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [closeSidebar]);

  const shellClass = `admin-shell${sidebarOpen ? ' admin-sidebar-open' : ''}`;

  return { sidebarOpen, closeSidebar, toggleSidebar, shellClass };
}
