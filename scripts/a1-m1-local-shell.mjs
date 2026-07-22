/**
 * A1 M1–M4 local Workspace shell (Worker path-split without Cloudflare deploy).
 * Serves vendored FE + offline stubs + CP sync + online Runtime HTTP/WS proxy.
 *
 * Usage:
 *   node scripts/vendor-comfy-frontend.mjs
 *   node scripts/vendor-cp-sync-extension.mjs
 *   node scripts/a1-m1-local-shell.mjs
 *   open http://127.0.0.1:5191/enter/gvc.xxx
 *
 * M4 online: mint runtime token (upstream set) → shell proxies non-static → Runtime.
 */
import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  isWorkspaceStaticPath,
  offlineBootStub,
  jsonResponse,
} from '../workers/comfy-proxy/src/workspace-shell.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const FE = join(root, 'workers/comfy-proxy/public');
const PORT = Number(process.env.A1_M1_PORT || 5191);

function loadEnv() {
  const p = join(root, '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[t.slice(0, i).trim()] == null) {
      process.env[t.slice(0, i).trim()] = v;
    }
  }
}
loadEnv();

const CP_ORIGIN = String(
  process.env.A1_CP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000',
).replace(/\/$/, '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

if (!existsSync(join(FE, 'index.html'))) {
  console.error('Missing vendored FE. Run: node scripts/vendor-comfy-frontend.mjs');
  process.exit(1);
}

function base64UrlEncode(str) {
  return Buffer.from(String(str), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeBootstrapFragment(payload) {
  return `gvn_cp=${base64UrlEncode(JSON.stringify({ v: 1, ...payload }))}`;
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

async function proxyCpSync(req, res, u, token) {
  const target = new URL('/api/cp/comfy-sync', CP_ORIGIN);
  for (const [k, v] of u.searchParams.entries()) target.searchParams.set(k, v);

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const ct = req.headers['content-type'];
  if (ct) headers['Content-Type'] = ct;

  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyBuf = Buffer.concat(chunks);

  try {
    const upstream = await fetch(target.toString(), {
      method: req.method || 'GET',
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : bodyBuf,
      signal: AbortSignal.timeout(8_000),
    });
    const text = await upstream.text();
    // WordPress/HTML or connection oddities → fall through to inline.
    const ctOut = upstream.headers.get('content-type') || '';
    if (upstream.ok && ctOut.includes('json')) {
      res.writeHead(upstream.status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(text);
      return;
    }
  } catch {
    /* inline fallback */
  }

  // Inline SoT (same libs as /api/cp/comfy-sync) for local M3 without Next.
  const { resolveComfyAccessToken } = await import(
    '../src/lib/comfy-proxy/comfy-access-token.js'
  );
  const { COMFY_ACCESS_TOKEN_PREFIX } = await import(
    '../src/lib/comfy-proxy/comfy-proxy-config.js'
  );
  const { ensureActiveCpWorkflow } = await import(
    '../src/lib/cp-runtime/ensure-active-workflow.js'
  );
  const {
    normalizeCpWorkflowDocument,
    shouldRejectEmptyDocumentOverwrite,
    toComfySyncPayload,
  } = await import('../src/lib/cp-runtime/comfy-graph-document.js');
  const {
    getCpWorkflow,
    toWorkflowClientSyncPayload,
    upsertCpWorkflowDocument,
  } = await import('../src/lib/cp-runtime/workflow-sot.js');

  const sb = getSb();

  if (!String(token).startsWith(COMFY_ACCESS_TOKEN_PREFIX)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'comfy token required' }));
    return;
  }
  const resolved = await resolveComfyAccessToken(sb, token);
  if (!resolved) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid token' }));
    return;
  }

  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET') {
    const preferredId = u.searchParams.get('workflowId') || '';
    const workflow = await ensureActiveCpWorkflow(sb, resolved.userId, {
      workflowId: preferredId || null,
    });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        workflow: toComfySyncPayload(workflow, { machineId: resolved.machineId }),
      }),
    );
    return;
  }

  if (method === 'PATCH' || method === 'POST') {
    const body = bodyBuf.length ? JSON.parse(bodyBuf.toString('utf8')) : {};
    const preferredId = String(body.workflowId ?? body.id ?? u.searchParams.get('workflowId') ?? '').trim();
    const ensured = await ensureActiveCpWorkflow(sb, resolved.userId, {
      workflowId: preferredId || null,
    });
    const inboundDocument =
      body.document !== undefined ? normalizeCpWorkflowDocument(body.document) : undefined;
    if (
      inboundDocument !== undefined &&
      shouldRejectEmptyDocumentOverwrite(ensured.document, inboundDocument)
    ) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: true,
          skipped: 'empty_document_overwrite',
          workflow: toComfySyncPayload(ensured, { machineId: resolved.machineId }),
          client: toWorkflowClientSyncPayload(ensured),
        }),
      );
      return;
    }
    try {
      const row = await upsertCpWorkflowDocument(sb, {
        workflowId: ensured.id,
        userId: resolved.userId,
        name: body.name,
        document: inboundDocument,
        settings: body.settings,
        status: body.status,
        metadata: body.metadata,
        expectedRevision:
          body.expectedRevision != null ? Number(body.expectedRevision) : null,
      });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: true,
          workflow: toComfySyncPayload(row, { machineId: resolved.machineId }),
          client: toWorkflowClientSyncPayload(row),
        }),
      );
    } catch (error) {
      if (error?.code === 'REVISION_CONFLICT') {
        const current =
          error.workflow ||
          (await getCpWorkflow(sb, resolved.userId, ensured.id));
        res.writeHead(409, { 'content-type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ok: false,
            code: 'REVISION_CONFLICT',
            error: 'Workflow đã được cập nhật nơi khác. Tải lại từ Control Plane.',
            workflow: current
              ? toComfySyncPayload(current, { machineId: resolved.machineId })
              : null,
          }),
        );
        return;
      }
      throw error;
    }
    return;
  }

  res.writeHead(405, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** @returns {Promise<{ upstreamUrl: string | null; userId: string; machineId: string | null; mode: string } | null>} */
async function resolveSession(token) {
  if (!token) return null;
  const { resolveComfyAccessToken } = await import(
    '../src/lib/comfy-proxy/comfy-access-token.js'
  );
  return resolveComfyAccessToken(getSb(), token);
}

/**
 * M4: forward non-static HTTP to live Runtime (ADR-005 — shell is the Proxy).
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} upstreamBase
 */
async function proxyHttpToRuntime(req, res, upstreamBase) {
  const inbound = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const target = new URL(upstreamBase.replace(/\/$/, '') + inbound.pathname + inbound.search);
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyBuf = Buffer.concat(chunks);

  const headers = { ...req.headers, host: target.host };
  delete headers['cookie'];
  delete headers['content-length'];

  const init = {
    method: req.method || 'GET',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(120_000),
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = bodyBuf;
  }

  const upstream = await fetch(target.toString(), init);
  const outHeaders = {};
  upstream.headers.forEach((v, k) => {
    if (k.toLowerCase() === 'set-cookie') return;
    outHeaders[k] = v;
  });
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, outHeaders);
  res.end(buf);
}

/**
 * M4: WebSocket upgrade → Runtime /ws (progress / preview).
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:net').Socket} socket
 * @param {Buffer} head
 * @param {string} upstreamBase
 */
function proxyWsToRuntime(req, socket, head, upstreamBase) {
  const inbound = new URL(req.url || '/ws', `http://127.0.0.1:${PORT}`);
  const target = new URL(upstreamBase.replace(/\/$/, '') + inbound.pathname + inbound.search);
  const isHttps = target.protocol === 'https:';
  const lib = isHttps ? https : http;
  const headers = { ...req.headers, host: target.host };
  delete headers.cookie;

  const proxyReq = lib.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path: target.pathname + target.search,
    method: 'GET',
    headers,
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    const lines = ['HTTP/1.1 101 Switching Protocols'];
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        for (const item of v) lines.push(`${k}: ${item}`);
      } else {
        lines.push(`${k}: ${v}`);
      }
    }
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    if (proxyHead?.length) socket.write(proxyHead);
    if (head?.length) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('error', () => {
    try {
      socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    } catch {
      /* ignore */
    }
    socket.destroy();
  });

  proxyReq.end();
}

const server = http.createServer((req, res) => {
  void (async () => {
    try {
      const u = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

      if (u.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            milestone: 'A1-M4',
            fe: FE,
            cpOrigin: CP_ORIGIN,
            extensions: ['/extensions/gpuvietnam_cp_sync/cp_sync.js'],
            note: 'offline stubs | online Runtime proxy when token.upstream set',
          }),
        );
        return;
      }

      const enter = u.pathname.match(/^\/enter\/([^/]+)\/?$/);
      if (enter) {
        const token = decodeURIComponent(enter[1]);
        const bootstrap = encodeBootstrapFragment({
          t: token,
          a: CP_ORIGIN,
          ...(u.searchParams.get('workflowId')
            ? { w: u.searchParams.get('workflowId') }
            : {}),
        });
        res.writeHead(302, {
          Location: `/#${bootstrap}`,
          'Set-Cookie': `gvn_comfy=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
        });
        res.end();
        return;
      }

      const authHeader = String(req.headers.authorization || '');
      const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
      const token =
        readCookie(req, 'gvn_comfy') ||
        bearer ||
        u.searchParams.get('a1_token') ||
        u.searchParams.get('token');

      if (
        u.pathname === '/gpuvietnam/cp/sync' ||
        u.pathname.startsWith('/gpuvietnam/cp/')
      ) {
        if (!token) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing session token' }));
          return;
        }
        await proxyCpSync(req, res, u, token);
        return;
      }

      if (isWorkspaceStaticPath(u.pathname)) {
        let rel = u.pathname === '/' ? '/index.html' : u.pathname;
        const filePath = join(FE, rel.replace(/^\//, ''));
        if (
          !filePath.startsWith(FE) ||
          !existsSync(filePath) ||
          statSync(filePath).isDirectory()
        ) {
          // Online: pack extension JS may live only on Runtime
          const session = await resolveSession(token);
          if (session?.upstreamUrl) {
            await proxyHttpToRuntime(req, res, session.upstreamUrl);
            return;
          }
          res.writeHead(404);
          res.end('static miss');
          return;
        }
        const buf = readFileSync(filePath);
        res.writeHead(200, {
          'content-type': MIME[extname(filePath)] || 'application/octet-stream',
          'cache-control': 'no-cache',
        });
        res.end(buf);
        return;
      }

      const session = await resolveSession(token);
      const online = Boolean(session?.upstreamUrl);

      if (online) {
        await proxyHttpToRuntime(req, res, session.upstreamUrl);
        return;
      }

      if (!token) {
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Missing session. Open ComfyUI from the GPUVietnam dashboard.');
        return;
      }

      const stub = offlineBootStub(u.pathname, req.method);
      if (stub) {
        const packed = jsonResponse(stub.status, stub.body, stub.contentType);
        res.writeHead(packed.status, packed.headers);
        res.end(packed.body);
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'a1 offline', path: u.pathname }));
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  })();
});

server.on('upgrade', (req, socket, head) => {
  void (async () => {
    try {
      const token = readCookie(req, 'gvn_comfy');
      const session = await resolveSession(token);
      if (!session?.upstreamUrl) {
        socket.write(
          'HTTP/1.1 426 Upgrade Required\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nRuntime offline — WebSocket unavailable',
        );
        socket.destroy();
        return;
      }
      proxyWsToRuntime(req, socket, head, session.upstreamUrl);
    } catch {
      try {
        socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      } catch {
        /* ignore */
      }
      socket.destroy();
    }
  })();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    JSON.stringify(
      {
        A1_local_shell: 'listening',
        url: `http://127.0.0.1:${PORT}/`,
        fe: FE,
        cpOrigin: CP_ORIGIN,
        note: 'M4: offline stubs + online Runtime HTTP/WS proxy when token.upstream set',
      },
      null,
      2,
    ),
  );
});
