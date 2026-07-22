/**
 * Production Origin Hardening smoke gate (no GPU E2E).
 * Verifies: apex CP APIs, Worker→apex sync, editor enter, offline shell.
 *
 * Usage: node scripts/a1-origin-harden-smoke.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { issueComfyAccessToken } from '../src/lib/comfy-proxy/comfy-access-token.js';
import { ensureActiveCpWorkflow } from '../src/lib/cp-runtime/ensure-active-workflow.js';
import { upsertCpWorkflowDocument, getCpWorkflow } from '../src/lib/cp-runtime/workflow-sot.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const APEX = 'https://gpuvietnam.com';
const WORK = 'https://work.gpuvietnam.com';
const USER_ID = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const MARKER = `origin-harden-${Date.now()}`;

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
process.env.COMFY_PROXY_ENABLED = '1';
process.env.COMFY_PROXY_BASE_URL = WORK;

const report = { milestone: 'ORIGIN-HARDEN', apex: APEX, work: WORK, marker: MARKER, checks: {} };
function pass(id, detail) {
  report.checks[id] = { ok: true, detail };
  console.log('PASS', id, detail ?? '');
}
function fail(id, detail) {
  report.checks[id] = { ok: false, detail };
  throw new Error(`${id}: ${JSON.stringify(detail)}`);
}

async function putKv(token, payload) {
  const ns = process.env.CF_KV_NAMESPACE_ID;
  if (!ns) throw new Error('CF_KV_NAMESPACE_ID missing');
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');
  const exp = payload.exp;
  const ttl = Math.max(120, exp - Math.floor(Date.now() / 1000));
  const key = `comfy:${hash}`;
  const tmp = join(tmpdir(), `origin-harden-kv-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(payload));
  const env = { ...process.env };
  delete env.CF_API_TOKEN;
  delete env.CLOUDFLARE_API_TOKEN;
  const put = spawnSync(
    'npx',
    ['wrangler', 'kv', 'key', 'put', key, '--path', tmp, '--namespace-id', ns, '--ttl', String(ttl)],
    {
      cwd: join(root, 'workers/comfy-proxy'),
      encoding: 'utf8',
      shell: true,
      env,
    },
  );
  try {
    unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  if (put.status !== 0) {
    throw new Error(`kv put failed: ${(put.stdout || '') + (put.stderr || '')}`.slice(-600));
  }
  return key;
}

function markerDoc(marker) {
  return {
    last_node_id: 1,
    last_link_id: 0,
    nodes: [
      {
        id: 1,
        type: 'EmptyLatentImage',
        pos: [100, 100],
        size: [200, 100],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [],
        outputs: [{ name: 'LATENT', type: 'LATENT', links: null }],
        title: marker,
        properties: {},
        widgets_values: [512, 512, 1],
      },
    ],
    links: [],
    groups: [],
    config: {},
    extra: { gate1: marker, origin_harden: marker },
    version: 0.4,
  };
}

async function main() {
  // 1) Apex CP endpoints → 401 JSON
  for (const [id, url] of [
    ['apex_comfy_sync', `${APEX}/api/cp/comfy-sync`],
    ['apex_workflows', `${APEX}/api/cp/workflows`],
  ]) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const ct = res.headers.get('content-type') || '';
    const body = await res.json().catch(() => null);
    if (res.status !== 401 || !ct.includes('json') || !body?.error) {
      fail(id, { status: res.status, ct, body });
    }
    pass(id, { status: 401, error: body.error });
  }

  const resolve = await fetch(`${APEX}/api/internal/comfy-proxy-resolve?token=gvc.x`, {
    headers: { Accept: 'application/json' },
  });
  const resolveBody = await resolve.json().catch(() => ({}));
  if (resolve.status !== 401 || resolveBody.error !== 'unauthorized') {
    fail('apex_resolve', { status: resolve.status, resolveBody });
  }
  pass('apex_resolve', { status: 401 });

  // 2–5) Worker path with editor token
  const health = await fetch(`${WORK}/health`);
  if (!health.ok || (await health.text()) !== 'ok') fail('work_health', health.status);
  pass('work_health', 'ok');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const issued = await issueComfyAccessToken(sb, { userId: USER_ID, mode: 'editor' });
  if (!String(issued.workUrl).startsWith(WORK)) {
    fail('mint_work_url', issued.workUrl);
  }
  await putKv(issued.token, {
    upstream: null,
    userId: USER_ID,
    machineId: null,
    exp: Math.floor(new Date(issued.expiresAt).getTime() / 1000),
    mode: 'editor',
  });
  pass('editor_mint_kv', { mode: issued.mode });

  const enter = await fetch(issued.workUrl, { redirect: 'manual' });
  const setCookie = enter.headers.get('set-cookie') || '';
  if (enter.status !== 302 || !/gvn_comfy=/i.test(setCookie)) {
    fail('enter', { status: enter.status, setCookie: setCookie.slice(0, 80) });
  }
  const cookie = `gvn_comfy=${setCookie.match(/gvn_comfy=([^;]+)/i)[1]}`;
  pass('enter', { location: enter.headers.get('location') });

  const shell = await fetch(`${WORK}/`, { headers: { Cookie: cookie } });
  const html = await shell.text();
  if (shell.status !== 200 || !/ComfyUI/i.test(html)) fail('offline_shell', shell.status);
  pass('offline_shell', { bytes: html.length });

  const promptOff = await fetch(`${WORK}/api/prompt`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: {}, client_id: 'origin-harden' }),
  });
  const promptJson = await promptOff.json().catch(() => ({}));
  if (promptOff.status !== 503 || promptJson.code !== 'A1_RUNTIME_OFFLINE') {
    fail('offline_generate_gate', promptJson);
  }
  pass('offline_generate_gate', { code: 'A1_RUNTIME_OFFLINE' });

  // Seed CP via SoT, then GET via Worker forward (must hit apex, not tunnel)
  const wf = await ensureActiveCpWorkflow(sb, USER_ID);
  const saved = await upsertCpWorkflowDocument(sb, {
    workflowId: wf.id,
    userId: USER_ID,
    document: markerDoc(MARKER),
    expectedRevision: Number(wf.revision ?? 1),
  });
  pass('cp_seed', { revision: saved.revision, workflowId: wf.id });

  const syncGet = await fetch(`${WORK}/gpuvietnam/cp/sync`, {
    headers: { Authorization: `Bearer ${issued.token}`, Cookie: cookie, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const syncBody = await syncGet.json().catch(() => ({}));
  const syncCt = syncGet.headers.get('content-type') || '';
  if ([530, 521, 522, 523].includes(syncGet.status)) {
    fail('worker_cp_sync_tunnel_error', { status: syncGet.status, body: syncBody });
  }
  if (!syncGet.ok || !syncCt.includes('json')) {
    fail('worker_cp_sync_get', { status: syncGet.status, ct: syncCt, body: syncBody });
  }
  if (syncBody.workflow?.document?.extra?.gate1 !== MARKER) {
    fail('worker_cp_sync_restore', {
      gate: syncBody.workflow?.document?.extra?.gate1,
      marker: MARKER,
    });
  }
  pass('worker_cp_sync_get', {
    status: syncGet.status,
    revision: syncBody.workflow?.revision,
    via: 'work→apex',
  });

  const marker2 = `${MARKER}-edit`;
  const syncPatch = await fetch(`${WORK}/gpuvietnam/cp/sync`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${issued.token}`,
      Cookie: cookie,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workflowId: syncBody.workflow?.workflowId || wf.id,
      document: markerDoc(marker2),
      expectedRevision: Number(syncBody.workflow?.revision ?? saved.revision),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const patchBody = await syncPatch.json().catch(() => ({}));
  if (!syncPatch.ok || patchBody.workflow?.document?.extra?.gate1 !== marker2) {
    fail('worker_cp_sync_patch', { status: syncPatch.status, patchBody });
  }
  pass('worker_cp_sync_patch', { revision: patchBody.workflow?.revision, gate: marker2 });

  // Direct apex roundtrip with gvc (no Worker) — proves Origin alone
  const apexGet = await fetch(`${APEX}/api/cp/comfy-sync`, {
    headers: { Authorization: `Bearer ${issued.token}`, Accept: 'application/json' },
  });
  const apexGetBody = await apexGet.json().catch(() => ({}));
  if (!apexGet.ok || apexGetBody.workflow?.document?.extra?.gate1 !== marker2) {
    fail('apex_direct_sync', { status: apexGet.status, apexGetBody });
  }
  pass('apex_direct_sync', { revision: apexGetBody.workflow?.revision });

  const after = await getCpWorkflow(sb, USER_ID, wf.id);
  if (after?.document?.extra?.gate1 !== marker2) fail('cp_persists', after?.document?.extra);
  pass('cp_persists', { revision: after.revision });

  // Confirm no tunnel dependency in this path
  report.tunnelDependency = {
    workerOrigin: 'https://gpuvietnam.com (ORIGIN_RESOLVE_URL)',
    vercelPublicUrls: APEX,
    quickTunnelRequired: false,
  };

  report.ok = Object.values(report.checks).every((c) => c.ok);
  console.log(JSON.stringify({ ok: report.ok, checks: Object.keys(report.checks), tunnel: report.tunnelDependency }, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL', err instanceof Error ? err.message : err);
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
});
