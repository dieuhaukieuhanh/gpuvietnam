/**
 * GPUVietnam ComfyUI reverse proxy (Cloudflare Worker).
 *
 * Cookie-based routing so ComfyUI absolute paths (/ws, /api/...) keep working:
 *   GET /enter/:token  → Set-Cookie + redirect /
 *   /*                 → proxy to upstream using cookie (or KV/origin resolve)
 *
 * Bindings (wrangler.toml):
 *   COMFY_ACCESS (KV, optional)
 *   ORIGIN_RESOLVE_URL  e.g. https://gpuvietnam.com/api/internal/comfy-proxy-resolve
 *   COMFY_PROXY_SECRET
 *   COOKIE_NAME         default gvn_comfy
 */

const COOKIE_DEFAULT = 'gvn_comfy';

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      return new Response('Proxy error', { status: 502 });
    }
  },
};

async function handle(request, env) {
  const url = new URL(request.url);
  const cookieName = env.COOKIE_NAME || COOKIE_DEFAULT;

  if (url.pathname === '/health' || url.pathname === '/healthz') {
    return new Response('ok', { status: 200 });
  }

  const enterMatch = url.pathname.match(/^\/enter\/([^/]+)\/?$/);
  if (enterMatch) {
    const token = decodeURIComponent(enterMatch[1]);
    const resolved = await resolveToken(token, env);
    if (!resolved) {
      return new Response('Session expired or invalid. Open ComfyUI again from the dashboard.', {
        status: 401,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    const secure = url.protocol === 'https:';
    const maxAge = Math.max(60, resolved.exp - Math.floor(Date.now() / 1000));
    const headers = new Headers();
    headers.set(
      'Set-Cookie',
      `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`,
    );
    headers.set('Location', '/');
    return new Response(null, { status: 302, headers });
  }

  const token = readCookie(request, cookieName);
  if (!token) {
    return new Response('Missing session. Open ComfyUI from the GPUVietnam dashboard.', {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const resolved = await resolveToken(token, env);
  if (!resolved) {
    const headers = new Headers({ 'content-type': 'text/plain; charset=utf-8' });
    headers.set(
      'Set-Cookie',
      `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    return new Response('Session expired. Open ComfyUI again from the dashboard.', {
      status: 410,
      headers,
    });
  }

  return proxyToUpstream(request, resolved.upstream);
}

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const parts = raw.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

async function resolveToken(token, env) {
  const hashHex = await sha256Hex(token);
  const kvKey = `comfy:${hashHex}`;

  if (env.COMFY_ACCESS) {
    try {
      const cached = await env.COMFY_ACCESS.get(kvKey, 'json');
      if (cached && cached.upstream && cached.exp > Math.floor(Date.now() / 1000)) {
        return { upstream: String(cached.upstream).replace(/\/$/, ''), exp: Number(cached.exp) };
      }
    } catch {
      /* fall through */
    }
  }

  const origin = String(env.ORIGIN_RESOLVE_URL || '').trim();
  const secret = String(env.COMFY_PROXY_SECRET || '').trim();
  if (!origin || !secret) return null;

  const resolveUrl = new URL(origin);
  resolveUrl.searchParams.set('token', token);
  const res = await fetch(resolveUrl.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return null;
  const body = await res.json();
  if (!body || !body.upstreamUrl) return null;
  const exp = body.expiresAt
    ? Math.floor(new Date(body.expiresAt).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + 3600;

  if (env.COMFY_ACCESS) {
    const ttl = Math.max(60, exp - Math.floor(Date.now() / 1000));
    try {
      await env.COMFY_ACCESS.put(
        kvKey,
        JSON.stringify({
          upstream: body.upstreamUrl,
          userId: body.userId,
          machineId: body.machineId,
          exp,
        }),
        { expirationTtl: ttl },
      );
    } catch {
      /* ignore */
    }
  }

  return { upstream: String(body.upstreamUrl).replace(/\/$/, ''), exp };
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function proxyToUpstream(request, upstreamBase) {
  const inbound = new URL(request.url);
  const target = new URL(upstreamBase + inbound.pathname + inbound.search);

  const headers = new Headers(request.headers);
  headers.delete('cookie');
  headers.delete('host');
  headers.set('Host', target.host);
  // Avoid compressing twice / odd CF behavior
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ray');
  headers.delete('cf-visitor');
  headers.delete('x-forwarded-proto');
  headers.delete('x-real-ip');

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    // @ts-expect-error duplex for streaming
    init.duplex = 'half';
  }

  const upstreamRes = await fetch(target.toString(), init);
  const outHeaders = new Headers(upstreamRes.headers);
  const location = outHeaders.get('Location');
  if (location) {
    try {
      const locUrl = new URL(location, target);
      if (locUrl.origin === target.origin) {
        outHeaders.set('Location', locUrl.pathname + locUrl.search + locUrl.hash);
      }
    } catch {
      /* keep */
    }
  }

  // Strip upstream cookies (session is ours)
  outHeaders.delete('set-cookie');

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: outHeaders,
  });
}