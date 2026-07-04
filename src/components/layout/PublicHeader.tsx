import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import UserMenu from '@/components/layout/UserMenu';
import { useAuth } from '@/contexts/AuthContext';
import { brand } from '@/lib/constants';
import { publicNavItems } from '@/lib/navigation';
import { routes } from '@/lib/routes';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { publicHeaderStyles } from '@/styles/layout/public-header.styles';

type PublicHeaderProps = {
  activeHref?: string;
  showCta?: boolean;
  showNav?: boolean;
  onTrialClick?: () => void;
};

export default function PublicHeader({
  activeHref,
  showCta = true,
  showNav = true,
  onTrialClick,
}: PublicHeaderProps) {
  const { user, loading: authLoading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      try {
        const supabase = getSupabaseBrowser();
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setHasSession(Boolean(data.session));
      } catch {
        if (mounted) setHasSession(false);
      } finally {
        if (mounted) setSessionReady(true);
      }
    }

    checkSession();

    const supabase = getSupabaseBrowser();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
      setSessionReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const isLoggedIn = sessionReady ? hasSession || Boolean(user) : Boolean(user);
  const showGuestActions = sessionReady && !isLoggedIn;
  const showUserMenu = sessionReady && isLoggedIn;

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handleResize = () => {
      if (window.innerWidth > 900) setMenuOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [menuOpen]);

  const trialButton =
    showCta && showGuestActions ? (
      onTrialClick ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={onTrialClick}>
          Dùng thử miễn phí
        </button>
      ) : (
        <Link href={`${routes.register}?trial=true`} className="btn btn-primary btn-sm" onClick={closeMenu}>
          Dùng thử miễn phí
        </Link>
      )
    ) : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: publicHeaderStyles }} />
      <header className="header">
        <div className="container">
          <Link href={routes.home} className="logo" onClick={closeMenu}>
            <div className="logo-icon">{brand.icon}</div>
            {brand.name}
          </Link>

          <button
            type="button"
            className="header-menu-toggle"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Đóng menu' : 'Mở menu'}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            {menuOpen ? '✕' : '☰'}
          </button>

          <div className={`header-nav-wrap${menuOpen ? ' is-open' : ''}`}>
            {showNav && (
              <nav className="nav">
                {publicNavItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className={activeHref === item.href ? 'active' : undefined}
                    onClick={closeMenu}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            )}

            <div className="header-auth-actions header-auth-actions--stack">
              {authLoading && !sessionReady ? null : showGuestActions ? (
                <>
                  <Link
                    href={routes.login}
                    className="btn btn-outline-white btn-sm"
                    onClick={closeMenu}
                  >
                    Đăng nhập
                  </Link>
                  {trialButton}
                </>
              ) : showUserMenu ? (
                <UserMenu />
              ) : null}
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
