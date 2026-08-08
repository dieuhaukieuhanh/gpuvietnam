import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { routes } from '@/lib/routes';

export default function GoogleCallbackPage() {
  const router = useRouter();
  const { applySession } = useAuth();
  const [error, setError] = useState('');
  const [step, setStep] = useState('Đang xác thực với Google...');

  useEffect(() => {
    if (!router.isReady) return;

    const code = router.query.code as string;
    if (!code) {
      setError('Thiếu mã xác thực từ Google.');
      return;
    }

    const redirectUri = `${window.location.origin}/auth/google-callback`;

    setStep('Đang xác minh tài khoản...');

    fetch('/api/auth/google-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri }),
    })
      .then((res) => res.json())
      .then(async (data) => {
        if (!data.id_token) {
          setError(data.error || 'Không lấy được token Google.');
          return;
        }

        setStep('Đang đăng nhập...');

        const supabase = getSupabaseBrowser();
        const { data: authData, error: authError } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: data.id_token,
          access_token: data.access_token,
        });

        if (authError) {
          setError(authError.message);
          return;
        }

        if (authData.session) {
          setStep('Đang đồng bộ tài khoản...');

          // Sync profile + role (phải await để có role trước khi redirect)
          let role = 'user';
          try {
            const profileRes = await fetch('/api/auth/ensure-profile', {
              method: 'POST',
              headers: { Authorization: `Bearer ${authData.session.access_token}` },
            });
            const profileData = await profileRes.json();
            if (profileData.role) role = profileData.role;
          } catch { /* fallback */ }

          await applySession(authData.session, { role });
          const dest = role === 'admin' ? '/admin' : ((router.query.state as string) || routes.dashboard);
          router.replace(dest);
        } else {
          setError('Không tạo được phiên đăng nhập.');
        }
      })
      .catch(() => {
        setError('Không thể kết nối máy chủ.');
      });
  }, [router.isReady, router.query.code, router.query.state, router, applySession]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#0A0A0F', color: '#F1F1F5',
      fontFamily: 'Inter, sans-serif', fontSize: 14,
    }}>
      <div style={{ textAlign: 'center' }}>
        {error ? (
          <>
            <div style={{ fontSize: 36, marginBottom: 12 }}>❌</div>
            <p style={{ color: '#f87171', marginBottom: 16 }}>{error}</p>
            <button
              className="auth-submit"
              style={{ padding: '10px 24px', cursor: 'pointer' }}
              onClick={() => router.replace(routes.login)}
            >
              Về trang đăng nhập
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔄</div>
            <p>{step}</p>
          </>
        )}
      </div>
    </div>
  );
}
