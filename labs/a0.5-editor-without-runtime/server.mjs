/**
 * A0.5 lab server — static Comfy FE + offline stubs (no GPU Runtime).
 *
 * Usage:
 *   node labs/a0.5-editor-without-runtime/server.mjs
 * Env:
 *   A05_PORT=5190
 *   A05_FE_STATIC=path/to/comfyui_frontend_package/static
 *   A05_CP_ORIGIN=http://127.0.0.1:3000   (proxy /lab/cp/* → Next)
 *   A05_CP_TOKEN=supabase_jwt             (optional default Bearer for CP proxy)
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from './ws-shim.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.A05_PORT || 5190);
const CP_ORIGIN = (process.env.A05_CP_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '');
const CP_TOKEN = (process.env.A05_CP_TOKEN || '').trim();

const DEFAULT_FE = resolve(
  here,
  '../../../ComfyUI/.venv/Lib/site-packages/comfyui_frontend_package/static',
);
const FE_STATIC = resolve(process.env.A05_FE_STATIC || DEFAULT_FE);
const FIX = join(here, 'fixtures');

function loadJson(name, fallback) {
  const p = join(FIX, name);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, 'utf8'));
}

const objectInfo = loadJson('object_info.offline.json', {});
const settingsBase = loadJson('settings.sample.json', {});
/** Lab settings: force tutorial complete + installed version so boot is quiet. */
const settings = {
  ...settingsBase,
  'Comfy.InstalledVersion': '1.45.21',
  'Comfy.TutorialCompleted': true,
  'A0.5.RuntimeMode': 'offline',
};

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
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(data);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function injectLabHtml(html) {
  const banner = `<style>
#a05-banner{position:fixed;top:0;left:0;right:0;z-index:100000;background:#1a2332;color:#f6d58a;font:13px/1.4 system-ui,sans-serif;padding:8px 14px;border-bottom:1px solid #3a4a63;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
#a05-banner button{cursor:pointer;border:1px solid #6b7c99;background:#243247;color:#e8eef8;border-radius:6px;padding:4px 10px;font:12px system-ui,sans-serif}
#a05-banner .ok{color:#8ddea8} #a05-banner .warn{color:#f6d58a}
body.litegraph{padding-top:40px}
</style>
<div id="a05-banner">
  <strong>A0.5 Lab</strong>
  <span class="warn" id="a05-status">Runtime offline — Generate bị chặn</span>
  <button type="button" id="a05-save">Lưu graph → CP</button>
  <button type="button" id="a05-load">Nạp graph từ CP</button>
  <span id="a05-msg"></span>
</div>
<script src="/lab/a05_bridge.js"></script>`;
  if (html.includes('</body>')) return html.replace('</body>', `${banner}</body>`);
  return html + banner;
}

async function proxyCp(req, res, subPath) {
  const url = `${CP_ORIGIN}${subPath}${req.url.includes('?') ? '' : ''}`;
  // subPath already includes query from caller
  const target = `${CP_ORIGIN}${subPath}`;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const auth = req.headers.authorization || (CP_TOKEN ? `Bearer ${CP_TOKEN}` : '');
  if (auth) headers.Authorization = auth;
  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const buf = await readBody(req);
    init.body = buf.length ? buf : undefined;
  }
  try {
    const upstream = await fetch(target, init);
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(text);
  } catch (e) {
    sendJson(res, 502, {
      error: 'CP proxy failed',
      detail: e instanceof Error ? e.message : String(e),
      target,
    });
  }
}

function apiHandler(req, res, pathname) {
  const path = pathname.replace(/^\/api/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  // --- Boot stubs ---
  if (path === '/settings' && req.method === 'GET') {
    return sendJson(res, 200, settings);
  }
  if (path.startsWith('/settings/') && (req.method === 'POST' || req.method === 'PUT')) {
    return sendJson(res, 200, { ok: true, stub: true });
  }
  if (path === '/users' && req.method === 'GET') {
    return sendJson(res, 200, loadJson('users.sample.json', { storage: 'server', users: [] }));
  }
  if (path === '/system_stats' && req.method === 'GET') {
    return sendJson(res, 200, {
      system: {
        os: 'a0.5-lab',
        comfyui_version: '0.28.0-offline-lab',
        python_version: 'n/a',
        pytorch_version: 'n/a',
        embedded_python: false,
        argv: ['a0.5-editor-without-runtime'],
      },
      devices: [],
      a05: { runtimeOnline: false, mode: 'offline' },
    });
  }
  if (path === '/i18n' && req.method === 'GET') {
    return sendJson(res, 200, {});
  }
  if (path === '/extensions' && req.method === 'GET') {
    // Empty: bundled core extensions load from FE package; avoid 404 custom pack JS.
    return sendJson(res, 200, []);
  }
  if (path === '/object_info' && req.method === 'GET') {
    return sendJson(res, 200, objectInfo);
  }
  if (path.startsWith('/object_info/') && req.method === 'GET') {
    const name = decodeURIComponent(path.slice('/object_info/'.length));
    if (objectInfo[name]) return sendJson(res, 200, { [name]: objectInfo[name] });
    return sendJson(res, 404, { error: 'node not in offline catalog', name });
  }
  if (path.startsWith('/userdata')) {
    if (req.method === 'GET') {
      // FE treats 404 as empty list for dir listings
      return sendText(res, 404, 'Directory not found');
    }
    return sendJson(res, 200, { ok: true, stub: true });
  }
  if (path === '/experiment/models' && req.method === 'GET') {
    return sendJson(res, 200, []);
  }
  if (path === '/features' || path === '/api/features') {
    return sendJson(res, 200, {});
  }

  // --- Runtime-dependent: soft fail / clear offline ---
  if (path === '/prompt' && req.method === 'POST') {
    return sendJson(res, 503, {
      error: 'Runtime chưa sẵn sàng',
      code: 'A05_RUNTIME_OFFLINE',
      node_errors: {},
    });
  }
  if (path === '/queue' && req.method === 'GET') {
    return sendJson(res, 200, { queue_running: [], queue_pending: [] });
  }
  if (path.startsWith('/history')) {
    return sendJson(res, 200, {});
  }
  if (path === '/interrupt' || path === '/free') {
    return sendJson(res, 503, { error: 'Runtime chưa sẵn sàng', code: 'A05_RUNTIME_OFFLINE' });
  }

  // Common soft stubs
  if (path === '/embeddings' || path === '/models' || path.startsWith('/models/')) {
    return sendJson(res, 200, []);
  }

  sendJson(res, 404, { error: 'a0.5 stub miss', path });
}

async function staticHandler(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  if (rel.startsWith('/lab/')) {
    const labFile = join(here, 'web', rel.slice('/lab/'.length));
    if (!existsSync(labFile)) return sendText(res, 404, 'lab asset missing');
    const buf = readFileSync(labFile);
    res.writeHead(200, {
      'Content-Type': MIME[extname(labFile)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    return res.end(buf);
  }

  const filePath = join(FE_STATIC, rel.replace(/^\//, ''));
  if (!filePath.startsWith(FE_STATIC) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    return sendText(res, 404, `static miss: ${rel}`);
  }
  let buf = readFileSync(filePath);
  let type = MIME[extname(filePath)] || 'application/octet-stream';
  if (rel === '/index.html' || rel.endsWith('index.html')) {
    buf = Buffer.from(injectLabHtml(buf.toString('utf8')), 'utf8');
    type = 'text/html; charset=utf-8';
  }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(buf);
}

if (!existsSync(join(FE_STATIC, 'index.html'))) {
  console.error('FE static not found:', FE_STATIC);
  process.exit(1);
}
if (!Object.keys(objectInfo).length) {
  console.error('Missing fixtures/object_info.offline.json — run capture-object-info.mjs first');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const pathname = u.pathname;

  try {
    if (pathname === '/lab/health') {
      return sendJson(res, 200, {
        ok: true,
        fe: FE_STATIC,
        offlineNodes: Object.keys(objectInfo).length,
        cpOrigin: CP_ORIGIN,
        runtimeOnline: false,
      });
    }

    // Lab-only helper: JWT from env or tmp file (never for production).
    if (pathname === '/lab/dev/session' && req.method === 'GET') {
      let tok = CP_TOKEN;
      if (!tok) {
        const p = resolve(here, '../../tmp/a05-token.txt');
        if (existsSync(p)) tok = readFileSync(p, 'utf8').trim();
      }
      if (!tok) return sendJson(res, 404, { error: 'no lab token' });
      return sendJson(res, 200, {
        token: tok,
        workflowId: process.env.GATE1_WORKFLOW_ID || 'f287ec3d-f268-4ddb-a0cd-460deec8e5bf',
      });
    }

    if (pathname.startsWith('/lab/cp/')) {
      const rest = pathname.slice('/lab/cp'.length) + u.search;
      return proxyCp(req, res, rest);
    }

    if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/ws') {
      // /ws handled by upgrade; HTTP /ws → 426
      if (pathname === '/ws') return sendText(res, 426, 'Use WebSocket');
      return apiHandler(req, res, pathname);
    }

    // Comfy also hits some paths without /api prefix
    if (
      [
        '/settings',
        '/users',
        '/system_stats',
        '/extensions',
        '/object_info',
        '/prompt',
        '/queue',
        '/history',
        '/embeddings',
        '/i18n',
      ].includes(pathname) ||
      pathname.startsWith('/object_info/') ||
      pathname.startsWith('/userdata') ||
      pathname.startsWith('/history/') ||
      pathname.startsWith('/settings/')
    ) {
      return apiHandler(req, res, pathname);
    }

    return staticHandler(req, res, pathname);
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  if (u.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    // Soft presence: FE can open WS; we never claim execution progress.
    ws.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: 'a05-offline' } }));
    ws.send(
      JSON.stringify({
        type: 'notification',
        data: { message: 'A0.5: Runtime offline — Generate disabled', type: 'info' },
      }),
    );
    ws.on('message', () => {
      /* ignore */
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    JSON.stringify(
      {
        A05_lab: 'listening',
        url: `http://127.0.0.1:${PORT}/`,
        fe: FE_STATIC,
        offlineNodes: Object.keys(objectInfo).length,
        cpOrigin: CP_ORIGIN,
        note: 'No GPU Runtime required',
      },
      null,
      2,
    ),
  );
});
