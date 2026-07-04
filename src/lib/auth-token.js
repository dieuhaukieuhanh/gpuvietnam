/**

 * Lấy user id (sub) từ Supabase access_token JWT — chỉ dùng phía server.

 */

export function getUserIdFromAccessToken(accessToken) {

  if (!accessToken || typeof accessToken !== 'string') return null;



  try {

    const parts = accessToken.split('.');

    if (parts.length < 2) return null;



    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');

    const pad = base64.length % 4;

    if (pad) base64 += '='.repeat(4 - pad);



    const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));



    return typeof payload.sub === 'string' ? payload.sub : null;

  } catch {

    return null;

  }

}

