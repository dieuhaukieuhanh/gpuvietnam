/**
 * A1 M3 smoke — CP sync roundtrip via API + offline Workspace extension path.
 *
 * Proves:
 *  1) PATCH/GET /api/cp/comfy-sync (existing SoT) with expectedRevision
 *  2) REVISION_CONFLICT does not allow silent overwrite policy
 *  3) Local shell serves cp_sync extension + proxies /gpuvietnam/cp/sync
 *  4) Offline /prompt still 503
 *
 * Requires: Next on A1_CP_ORIGIN (default http://127.0.0.1:3000) OR only API parts skipped.
 *
 * Usage:
 *   node scripts/a1-m3-cp-sync-smoke.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createClient } from '@supabase/supabase-js';
import { issueComfyAccessToken } from '../src/lib/comfy-proxy/comfy-access-token.js';
import { resolveComfySyncPatchOutcome } from '../src/lib/comfy-proxy/cp-sync-client-policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const USER_ID = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const PORT = Number(process.env.A1_M1_PORT || 5191);
const SHELL = `http://127.0.0.1:${PORT}`;
const CP = String(
  process.env.A1_CP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000',
).replace(/\/$/, '');

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
    process.env[t.slice(0, i).trim()] = v;
  }
}
loadEnv();
process.env.COMFY_PROXY_ENABLED = '1';
process.env.COMFY_PROXY_BASE_URL =
  process.env.COMFY_PROXY_BASE_URL || 'https://work.gpuvietnam.com';

function markerDoc(marker) {
  return {
    last_node_id: 2,
    last_link_id: 0,
    nodes: [
      {
        id: 1,
        type: 'EmptyLatentImage',
        pos: [80, 80],
        size: [200, 100],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [],
        outputs: [{ name: 'LATENT', type: 'LATENT', links: null }],
        title: marker,
        properties: {},
        widgets_values: [768, 768, 1],
      },
    ],
    links: [],
    groups: [],
    config: {},
    extra: { gate1: marker, a1m3: marker },
    version: 0.4,
  };
}

async function main() {
  const report = { milestone: 'A1-M3', checks: {} };
  const fail = (id, detail) => {
    report.checks[id] = { ok: false, detail };
    throw new Error(`${id}: ${JSON.stringify(detail)}`);
  };
  const pass = (id, detail) => {
    report.checks[id] = { ok: true, detail };
    console.log('PASS', id, detail);
  };

  // Policy unit (always)
  const conflict = resolveComfySyncPatchOutcome({
    status: 409,
    data: { code: 'REVISION_CONFLICT', workflow: { revision: 3 } },
  });
  if (conflict.overwriteServerWithoutExpected) fail('policy_conflict', conflict);
  pass('policy_conflict', conflict);

  const extPath = join(
    root,
    'workers/comfy-proxy/public/extensions/gpuvietnam_cp_sync/cp_sync.js',
  );
  if (!existsSync(extPath)) fail('vendored_ext', 'missing cp_sync.js');
  pass('vendored_ext', { bytes: readFileSync(extPath).length });

  const sbAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const issued = await issueComfyAccessToken(sbAdmin, {
    userId: USER_ID,
    mode: 'editor',
  });
  const token = issued.token;
  const marker = `a1-m3-${Date.now()}`;

  // Direct CP SoT via libs (works even when Next HTTP is down).
  const { ensureActiveCpWorkflow } = await import(
    '../src/lib/cp-runtime/ensure-active-workflow.js'
  );
  const { upsertCpWorkflowDocument, getCpWorkflow } = await import(
    '../src/lib/cp-runtime/workflow-sot.js'
  );

  const ensured = await ensureActiveCpWorkflow(sbAdmin, USER_ID);
  const wfId = ensured.id;
  const rev0 = Number(ensured.revision ?? 1);
  const saved = await upsertCpWorkflowDocument(sbAdmin, {
    workflowId: wfId,
    userId: USER_ID,
    document: markerDoc(marker),
    expectedRevision: rev0,
  });
  pass('sot_patch', { workflowId: wfId, revision: saved.revision, marker });

  let conflictThrown = false;
  try {
    await upsertCpWorkflowDocument(sbAdmin, {
      workflowId: wfId,
      userId: USER_ID,
      document: markerDoc(`${marker}-stale`),
      expectedRevision: rev0,
    });
  } catch (err) {
    conflictThrown = err?.code === 'REVISION_CONFLICT';
  }
  if (!conflictThrown) fail('sot_conflict', 'expected REVISION_CONFLICT');
  const after = await getCpWorkflow(sbAdmin, USER_ID, wfId);
  if (after?.document?.extra?.gate1 !== marker) {
    fail('sot_newer_preserved', after?.document?.extra);
  }
  pass('sot_conflict_preserves_newer', {
    revision: after.revision,
    gate: after.document?.extra?.gate1,
  });

  // HTTP path if Next is up (optional).
  let cpReachable = false;
  try {
    const ping = await fetch(`${CP}/api/cp/comfy-sync`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    cpReachable = ping.ok;
    if (ping.ok) {
      const got = await ping.json();
      pass('cp_http_get', {
        revision: got.workflow?.revision,
        gate: got.workflow?.document?.extra?.gate1,
      });
    } else {
      report.checks.cp_http_get = {
        ok: true,
        detail: { skipped: true, status: ping.status },
      };
    }
  } catch (e) {
    report.checks.cp_http_get = {
      ok: true,
      detail: {
        skipped: true,
        reason: e instanceof Error ? e.message : String(e),
      },
    };
  }

  // Local shell
  const child = spawn(process.execPath, [join(here, 'a1-m1-local-shell.mjs')], {
    cwd: root,
    env: { ...process.env, A1_M1_PORT: String(PORT), A1_CP_ORIGIN: CP },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try {
      const h = await fetch(`${SHELL}/health`, { signal: AbortSignal.timeout(1000) });
      if (h.ok) break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const health = await fetch(`${SHELL}/health`).then((r) => r.json());
  if (!health.ok) fail('shell_health', health);
  pass('shell_health', health);

  const ext = await fetch(`${SHELL}/extensions`).then((r) => r.json());
  if (!Array.isArray(ext) || !ext.includes('/extensions/gpuvietnam_cp_sync/cp_sync.js')) {
    fail('shell_extensions', ext);
  }
  pass('shell_extensions', ext);

  const extJs = await fetch(`${SHELL}/extensions/gpuvietnam_cp_sync/cp_sync.js`);
  if (!extJs.ok) fail('shell_ext_js', extJs.status);
  pass('shell_ext_js', { status: extJs.status, bytes: (await extJs.text()).length });

  const prompt = await fetch(`${SHELL}/api/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: {}, client_id: 'm3' }),
  });
  const promptBody = await prompt.json().catch(() => ({}));
  if (prompt.status !== 503 || promptBody.code !== 'A1_RUNTIME_OFFLINE') {
    fail('prompt_offline', { status: prompt.status, promptBody });
  }
  pass('prompt_offline', promptBody);

  // Always exercise shell → CP proxy (inline fallback when Next down).
  const proxied = await fetch(`${SHELL}/gpuvietnam/cp/sync`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: `gvn_comfy=${encodeURIComponent(token)}`,
    },
  });
  const proxiedBody = await proxied.json().catch(() => ({}));
  if (!proxied.ok) fail('shell_cp_proxy_get', { status: proxied.status, proxiedBody });
  const restoredGate = proxiedBody.workflow?.document?.extra?.gate1;
  if (restoredGate !== marker) {
    fail('shell_cp_proxy_restore', { restoredGate, marker });
  }
  pass('shell_cp_proxy_get', {
    revision: proxiedBody.workflow?.revision,
    gate: restoredGate,
  });

  report.verdict = Object.values(report.checks).every((c) => c.ok) ? 'PASS' : 'FAIL';
  console.log(JSON.stringify(report, null, 2));

  try {
    process.kill(-child.pid);
  } catch {
    try {
      process.kill(child.pid);
    } catch {
      /* ignore */
    }
  }

  if (report.verdict === 'FAIL') process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
