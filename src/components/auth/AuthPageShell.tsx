import Head from 'next/head';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { brand } from '@/lib/constants';
import { routes } from '@/lib/routes';
import { authPageStyles } from '@/styles/pages/auth-pages.styles';

type AuthPageShellProps = {
  pageTitle: string;
  formTitle: string;
  formSubtitle?: string;
  children: ReactNode;
};

export default function AuthPageShell({
  pageTitle,
  formTitle,
  formSubtitle,
  children,
}: AuthPageShellProps) {
  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        <style dangerouslySetInnerHTML={{ __html: authPageStyles }} />
      </Head>

      <div className="auth-page">
        <aside className="auth-hero">
          <Link href={routes.home} className="auth-back-link">
            ← Về trang chủ
          </Link>
          <div className="auth-hero-content">
            <div className="auth-logo">
              <span className="auth-logo-icon">{brand.icon}</span>
              <span>{brand.name}</span>
            </div>
            <p className="auth-tagline">Trạm làm việc trên mây cho AI Art</p>
            <div className="auth-illustration" aria-hidden>
              <span>🖥️</span>
              <span>☁️</span>
              <span>🎨</span>
            </div>
          </div>
        </aside>

        <main className="auth-main">
          <div className="auth-form-wrap">
            <Link href={routes.home} className="auth-back-link-mobile">
              ← Về trang chủ
            </Link>
            <div className="auth-form-card">
              <h1 className="auth-form-title">{formTitle}</h1>
              {formSubtitle ? <p className="auth-form-subtitle">{formSubtitle}</p> : null}
              {children}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
