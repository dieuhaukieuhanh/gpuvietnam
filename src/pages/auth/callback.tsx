import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { routes } from '@/lib/routes';

export default function AuthCallbackPage() {
  const router = useRouter();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    if (session) {
      // Google OAuth thành công → về dashboard
      const redirect = (router.query.redirect as string) || routes.dashboard;
      router.replace(redirect);
    } else {
      // Không có session → về login
      router.replace(routes.login);
    }
  }, [session, loading, router]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#0A0A0F', color: '#F1F1F5',
      fontFamily: 'Inter, sans-serif', fontSize: 14,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔄</div>
        <p>{loading ? 'Đang xác thực...' : 'Đang chuyển hướng...'}</p>
      </div>
    </div>
  );
}
