/**
 * URL gốc của site — dùng cho redirect Supabase (reset password, v.v.)
 */
export function getSiteUrl(req) {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;

  if (req?.headers?.host) {
    const proto = req.headers['x-forwarded-proto'] ?? 'http';
    return `${proto}://${req.headers.host}`;
  }

  return 'http://localhost:3000';
}
