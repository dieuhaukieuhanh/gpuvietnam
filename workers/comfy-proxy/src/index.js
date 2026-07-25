/**
 * GPUVietnam ComfyUI Workspace proxy (Cloudflare Worker) — A1 M1 path-split.
 *
 * Cookie-based routing so ComfyUI absolute paths (/ws, /api/...) keep working:
 *   GET /enter/:token  → Set-Cookie + redirect /#gvn_cp=…
 *   /gpuvietnam/cp/*   → origin /api/cp/comfy-sync (cookie auth → Bearer gvc)
 *   Workspace static   → ASSETS (FE package) or FE_STATIC_ORIGIN
 *   Offline (no upstream) → boot stubs + Supported Node Manifest catalog (M2); execution → 503
 *   Online             → proxy non-static to upstream Runtime (live object_info = M4)
 *
 * Bindings (wrangler.toml):
 *   COMFY_ACCESS (KV, optional)
 *   ASSETS (optional Workers Assets)
 *   ORIGIN_RESOLVE_URL
 *   COMFY_PROXY_SECRET
 *   FE_STATIC_ORIGIN (optional fallback for static when ASSETS missing)
 *   COOKIE_NAME         default gvn_comfy
 */

import {
  isWorkspaceStaticPath,
  offlineBootStub,
  jsonResponse,
} from './workspace-shell.js';
import { rewriteIpLiteralUpstreamForFetch } from './ip-hop.js';

const COOKIE_DEFAULT = 'gvn_comfy';
const CP_SYNC_PREFIX = '/gpuvietnam/cp/';

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`Proxy error: ${msg.slice(0, 200)}`, { status: 502 });
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
    const apiBase = resolveOriginApiBase(env);
    const bootstrap = encodeBootstrapFragment({
      t: token,
      ...(apiBase ? { a: apiBase } : {}),
    });
    headers.set('Location', `/#${bootstrap}`);
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

  if (url.pathname === '/gpuvietnam/cp/sync' || url.pathname.startsWith(CP_SYNC_PREFIX)) {
    return forwardCpSync(request, env, token, url);
  }

  const online = Boolean(resolved.upstream);

  // Always prefer Workspace FE for brand shell (A1 same-origin).
  if (isWorkspaceStaticPath(url.pathname)) {
    const staticRes = await serveWorkspaceStatic(request, env, url.pathname);
    if (staticRes) return staticRes;
    // Online fallback: proxy missing static from Runtime (rare).
    if (online) return proxyToUpstream(request, resolved.upstream, env);
    return new Response('Workspace FE assets not configured', { status: 503 });
  }

  if (!online) {
    if (url.pathname === '/ws' || url.pathname.startsWith('/ws')) {
      return offlineWsUpgradeHint();
    }
    const stub = offlineBootStub(url.pathname, request.method);
    if (stub) {
      const packed = jsonResponse(stub.status, stub.body, stub.contentType);
      return new Response(packed.body, { status: packed.status, headers: packed.headers });
    }
    return new Response(JSON.stringify({ error: 'a1 offline', path: url.pathname }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  // M4 online: prompt / object_info / extensions / history / view / upload / ws → Runtime
  return proxyToUpstream(request, resolved.upstream, env);
}

function offlineWsUpgradeHint() {
  // Browsers upgrade via 101; without WS handler here, return 426.
  // Local smoke / future M1+: attach soft WS. Avoid white-screen: FE tolerates WS fail.
  return new Response('Runtime offline — WebSocket unavailable', {
    status: 426,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {string} pathname
 */
async function serveWorkspaceStatic(request, env, pathname) {
  if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
    try {
      const res = await env.ASSETS.fetch(request);
      if (res && res.status !== 404) return res;
    } catch {
      /* fall through */
    }
  }

  const feOrigin = String(env.FE_STATIC_ORIGIN || '').trim().replace(/\/$/, '');
  if (!feOrigin) return null;

  const targetPath = pathname === '/' ? '/index.html' : pathname;
  const target = new URL(feOrigin + targetPath);
  try {
    const upstream = await fetch(target.toString(), {
      method: 'GET',
      headers: { Accept: request.headers.get('Accept') || '*/*' },
      redirect: 'manual',
    });
    if (!upstream.ok && upstream.status !== 304) return null;
    const headers = new Headers(upstream.headers);
    headers.delete('set-cookie');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return null;
  }
}

function encodeBootstrapFragment(payload) {
  const json = JSON.stringify({ v: 1, ...payload });
  const b64 = base64UrlEncode(json);
  return `gvn_cp=${b64}`;
}

function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

/**
 * @returns {Promise<{ upstream: string | null; exp: number; mode: string } | null>}
 */
async function resolveToken(token, env) {
  const hashHex = await sha256Hex(token);
  const kvKey = `comfy:${hashHex}`;

  if (env.COMFY_ACCESS) {
    try {
      const cached = await env.COMFY_ACCESS.get(kvKey, 'json');
      if (cached && cached.exp > Math.floor(Date.now() / 1000)) {
        const upstream = cached.upstream
          ? String(cached.upstream).replace(/\/$/, '')
          : null;
        return {
          upstream,
          exp: Number(cached.exp),
          mode: upstream ? 'runtime' : String(cached.mode || 'editor'),
        };
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
  if (!body || !body.userId) return null;

  const upstream = body.upstreamUrl
    ? String(body.upstreamUrl).replace(/\/$/, '')
    : null;
  const mode = body.mode || (upstream ? 'runtime' : 'editor');
  const exp = body.expiresAt
    ? Math.floor(new Date(body.expiresAt).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + 3600;

  if (env.COMFY_ACCESS) {
    const ttl = Math.max(60, exp - Math.floor(Date.now() / 1000));
    try {
      await env.COMFY_ACCESS.put(
        kvKey,
        JSON.stringify({
          upstream,
          userId: body.userId,
          machineId: body.machineId ?? null,
          exp,
          mode,
        }),
        { expirationTtl: ttl },
      );
    } catch {
      /* ignore */
    }
  }

  return { upstream, exp, mode };
}

async function forwardCpSync(request, env, token, inboundUrl) {
  const apiBase = resolveOriginApiBase(env);
  if (!apiBase) {
    return new Response(JSON.stringify({ ok: false, error: 'CP origin not configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const target = new URL('/api/cp/comfy-sync', apiBase);
  for (const [k, v] of inboundUrl.searchParams.entries()) {
    target.searchParams.set(k, v);
  }

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);

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
  outHeaders.delete('set-cookie');
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: outHeaders,
  });
}

function resolveOriginApiBase(env) {
  const explicit = String(env.ORIGIN_API_BASE || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  const resolve = String(env.ORIGIN_RESOLVE_URL || '').trim();
  if (!resolve) return '';
  try {
    return new URL(resolve).origin;
  } catch {
    return '';
  }
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function proxyToUpstream(request, upstreamBase, env) {
  const inbound = new URL(request.url);
  // Vast stores http://IP:port — CF Workers cannot fetch IP literals (1003).
  // Clore hostnames pass through unchanged. Hop default: dashed-IP.sslip.io
  const fetchBase = rewriteIpLiteralUpstreamForFetch(
    upstreamBase,
    env?.COMFY_IP_LITERAL_HOP_SUFFIX,
  );
  const target = new URL(fetchBase.replace(/\/$/, '') + inbound.pathname + inbound.search);

  // M4: WebSocket progress/preview — must pass the original Request so Workers
  // preserve the client↔Worker WebSocket pair while fetching the upstream.
  if (String(request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
    return fetch(target.toString(), request);
  }

  const headers = new Headers(request.headers);
  headers.delete('cookie');
  // Never set Host manually — Workers forbid overriding Host for subrequests
  // (can surface as CF 1003 with IP / exotic hop hostnames). Let fetch()
  // derive Host from the target URL (sslip hop or Clore hostname).
  headers.delete('host');
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

  outHeaders.delete('set-cookie');

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: outHeaders,
  });
}
