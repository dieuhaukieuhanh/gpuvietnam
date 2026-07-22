/**
 * A1 M1–M4 — Workspace shell helpers (path-split + offline boot stubs + catalog).
 * Shared by Cloudflare Worker and local smoke harness.
 */

import {
  getSupportedObjectInfo,
  getSupportedObjectInfoNode,
  offlineCatalogMeta,
} from './offline-catalog.js';

/**
 * Extension paths owned by Workspace FE (never proxied to GPU).
 * Pack custom-node JS comes from Runtime when online (M4).
 */
export function isWorkspaceOwnedExtensionPath(pathname) {
  const p = String(pathname || '');
  if (p.startsWith('/extensions/core/') || p === '/extensions/core') return true;
  if (p.startsWith('/extensions/gpuvietnam_cp_sync/')) return true;
  return false;
}

/** Paths always served from Workspace FE package (never from GPU). */
export function isWorkspaceStaticPath(pathname) {
  const p = String(pathname || '');
  if (p === '/' || p === '/index.html') return true;
  if (p.startsWith('/assets/')) return true;
  if (isWorkspaceOwnedExtensionPath(p)) return true;
  // Other /extensions/* → Runtime when online; offline 404 via stub miss.
  if (p.startsWith('/extensions/')) return false;
  if (p.startsWith('/fonts/')) return true;
  if (p.startsWith('/scripts/')) return true;
  if (p.startsWith('/cursor/')) return true;
  if (p.startsWith('/templates/')) return true;
  if (p === '/materialdesignicons.min.css') return true;
  if (p === '/user.css') return true;
  if (/\.(js|mjs|css|map|woff2?|ttf|png|svg|webp|ico|json)$/i.test(p)) return true;
  return false;
}

/** Runtime execution paths — must not be stubbed as success when offline. */
export function isRuntimeExecutionPath(pathname) {
  const p = String(pathname || '').replace(/^\/api/, '') || '/';
  if (p === '/prompt' || p.startsWith('/prompt/')) return true;
  if (p === '/interrupt' || p === '/free') return true;
  if (p.startsWith('/view')) return true;
  if (p.startsWith('/upload')) return true;
  return false;
}

/** Paths that must come from live Runtime when online (M4). */
export function isRuntimeLiveCatalogPath(pathname) {
  const raw = String(pathname || '');
  const path = raw.startsWith('/api') ? raw.slice(4) || '/' : raw;
  if (path === '/object_info' || path.startsWith('/object_info/')) return true;
  if (path === '/extensions') return true;
  if (path === '/system_stats') return true;
  if (path === '/queue' || path.startsWith('/queue/')) return true;
  if (path.startsWith('/history')) return true;
  return false;
}

/**
 * Minimal offline boot stubs so GraphCanvas can finish setup (A0.5 evidence).
 * Full catalog / Generate gate refined in M2–M4.
 * @param {string} pathname
 * @param {string} method
 * @returns {{ status: number; body: unknown; contentType?: string } | null}
 */
export function offlineBootStub(pathname, method = 'GET') {
  const raw = String(pathname || '');
  const path = raw.startsWith('/api') ? raw.slice(4) || '/' : raw;
  const m = String(method || 'GET').toUpperCase();

  if (path === '/settings' && m === 'GET') {
    return {
      status: 200,
      body: {
        'Comfy.InstalledVersion': '1.45.21',
        'Comfy.TutorialCompleted': true,
        'A1.RuntimeMode': 'offline',
      },
    };
  }
  if (path.startsWith('/settings/') && (m === 'POST' || m === 'PUT')) {
    return { status: 200, body: { ok: true, stub: true } };
  }
  if (path === '/users' && m === 'GET') {
    // Match Comfy multi-user bootstrap shape used in A0.5 capture (skips empty-user trap).
    return { status: 200, body: { storage: 'server', migrated: true } };
  }
  if (path === '/system_stats' && m === 'GET') {
    return {
      status: 200,
      body: {
        system: {
          os: 'a1-workspace',
          comfyui_version: '0.28.0-workspace',
          python_version: 'n/a',
          pytorch_version: 'n/a',
          embedded_python: false,
          argv: ['a1-m1-workspace-shell'],
        },
        devices: [],
        a1: { runtimeOnline: false, mode: 'editor' },
      },
    };
  }
  if (path === '/i18n' && m === 'GET') {
    return { status: 200, body: {} };
  }
  if (path === '/extensions' && m === 'GET') {
    // A1 M3: ship CP sync client on Workspace (B' — no GPU Runtime required).
    // Still not a full custom-node pack list.
    return {
      status: 200,
      body: ['/extensions/gpuvietnam_cp_sync/cp_sync.js'],
    };
  }
  if (path === '/object_info' && m === 'GET') {
    // M2: Supported Node Manifest snapshot (core + lock packs when capture complete).
    return { status: 200, body: getSupportedObjectInfo() };
  }
  if (path.startsWith('/object_info/') && m === 'GET') {
    const nodeName = decodeURIComponent(path.slice('/object_info/'.length));
    const def = getSupportedObjectInfoNode(nodeName);
    if (!def) {
      return {
        status: 404,
        body: {
          error: 'node not in Supported Node Manifest',
          code: 'A1_UNSUPPORTED_NODE',
          node: nodeName,
          catalog: offlineCatalogMeta(),
        },
      };
    }
    return { status: 200, body: def };
  }
  if (path.startsWith('/userdata')) {
    if (m === 'GET') {
      return { status: 404, body: 'Directory not found', contentType: 'text/plain; charset=utf-8' };
    }
    return { status: 200, body: { ok: true, stub: true } };
  }
  if (path === '/experiment/models' && m === 'GET') {
    return { status: 200, body: [] };
  }
  if (path === '/queue' && m === 'GET') {
    return { status: 200, body: { queue_running: [], queue_pending: [] } };
  }
  if (path.startsWith('/history')) {
    return { status: 200, body: {} };
  }
  if (path === '/embeddings' || path.startsWith('/models')) {
    return { status: 200, body: [] };
  }
  if (path === '/global_subgraphs' || path.startsWith('/global_subgraphs/')) {
    return { status: 200, body: [] };
  }
  if (path === '/node_replacements' && m === 'GET') {
    return { status: 200, body: {} };
  }
  if (path.startsWith('/jobs') && m === 'GET') {
    return { status: 200, body: [] };
  }
  if (path === '/workflow_templates' && m === 'GET') {
    return { status: 200, body: [] };
  }
  if (path === '/features' && m === 'GET') {
    return { status: 200, body: {} };
  }

  if (isRuntimeExecutionPath(raw) && m !== 'GET') {
    return {
      status: 503,
      body: {
        error: 'Runtime chưa sẵn sàng',
        code: 'A1_RUNTIME_OFFLINE',
        node_errors: {},
      },
    };
  }
  if (isRuntimeExecutionPath(raw) && m === 'GET') {
    return {
      status: 503,
      body: { error: 'Runtime chưa sẵn sàng', code: 'A1_RUNTIME_OFFLINE' },
    };
  }

  // Unknown API while offline
  if (raw.startsWith('/api/') || ['/settings', '/users', '/prompt', '/queue', '/object_info', '/extensions', '/system_stats', '/i18n'].some((x) => path === x || path.startsWith(`${x}/`))) {
    return {
      status: 404,
      body: { error: 'a1 offline stub miss', path: raw },
    };
  }

  return null;
}

export function jsonResponse(status, body, contentType) {
  if (contentType && contentType.startsWith('text/')) {
    return {
      status,
      headers: { 'content-type': contentType, 'cache-control': 'no-store' },
      body: typeof body === 'string' ? body : String(body),
    };
  }
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}
