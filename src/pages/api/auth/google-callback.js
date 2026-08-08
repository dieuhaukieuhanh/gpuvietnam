/**
 * Google OAuth callback — server-side code exchange.
 * Nhận authorization code từ Google, đổi lấy id_token,
 * trả về cho frontend để gọi supabase.auth.signInWithIdToken().
 *
 * Flow: Google redirect → /auth/google-callback?code=xxx
 *       → Frontend gọi API này → Server đổi code → Trả id_token
 *       → Frontend gọi supabase.auth.signInWithIdToken()
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, redirectUri } = req.body ?? {};

    if (!code) {
      return res.status(400).json({ error: 'Thiếu authorization code.' });
    }

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'Thiếu cấu hình Google OAuth. Cần NEXT_PUBLIC_GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET trên Vercel Production.' });
    }

    // Xác định redirect_uri: ưu tiên từ client, fallback về production
    const resolvedRedirectUri = redirectUri || 'https://gpuvietnam.com/auth/google-callback';

    // Đổi authorization code lấy tokens từ Google
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: resolvedRedirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || tokenData.error) {
      console.error('[google-callback] Token exchange failed:', tokenData.error_description || tokenData.error);
      return res.status(400).json({ error: 'Xác thực Google thất bại. Vui lòng thử lại.' });
    }

    // Trả id_token về cho frontend
    return res.status(200).json({
      id_token: tokenData.id_token,
      access_token: tokenData.access_token,
      email: tokenData.email,
    });
  } catch (err) {
    console.error('[google-callback] Error:', err.message);
    return res.status(500).json({ error: 'Xác thực Google thất bại.' });
  }
}
