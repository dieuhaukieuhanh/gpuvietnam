/**
 * Tạo Google OAuth URL trực tiếp — không qua Supabase redirect.
 * Google consent screen sẽ hiển thị domain của chúng ta (gpuvietnam.com),
 * không phải rhtqiecieeyqjlctcvag.supabase.co.
 */

export function getGoogleOAuthUrl(redirectPath = '/auth/google-callback') {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('Thiếu NEXT_PUBLIC_GOOGLE_CLIENT_ID');
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const redirectUri = `${origin}${redirectPath}`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
