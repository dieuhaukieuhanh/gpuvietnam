/**
 * A1 M3 production smoke on work.gpuvietnam.com
 * Mint editor token → wrangler KV put → browser-less API checks + optional CDP notes.
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
const WORK = 'https://work.gpuvietnam.com';
const USER_ID = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';

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
process.env.COMFY_PROXY_BASE_URL = process.env.COMFY_PROXY_BASE_URL || WORK;

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
        widgets_values: [640, 640, 1],
      },
    ],
    links: [],
    groups: [],
    config: {},
    extra: { gate1: marker, a1m3_prod: marker },
    version: 0.4,
  };
}

async function putKv(token, userId, expiresAt) {
  const ns = process.env.CF_KV_NAMESPACE_ID;
  if (!ns) throw new Error('CF_KV_NAMESPACE_ID missing');
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');
  const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
  const ttl = Math.max(120, exp - Math.floor(Date.now() / 1000));
  const key = `comfy:${hash}`;
  const payload = JSON.stringify({
    upstream: null,
    userId,
    machineId: null,
    exp,
    mode: 'editor',
  });
  const tmp = join(tmpdir(), `a1-m3-prod-kv-${Date.now()}.json`);
  writeFileSync(tmp, payload);
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
    throw new Error(`kv put failed: ${(put.stdout || '') + (put.stderr || '')}`.slice(-800));
  }
  return key;
}

async function main() {
  const report = { milestone: 'A1-M3-production', checks: {} };
  const pass = (id, detail) => {
    report.checks[id] = { ok: true, detail };
    console.log('PASS', id, detail);
  };
  const fail = (id, detail) => {
    report.checks[id] = { ok: false, detail };
    throw new Error(`${id}: ${JSON.stringify(detail)}`);
  };

  const health = await fetch(`${WORK}/health`, { signal: AbortSignal.timeout(15000) });
  if (!health.ok || (await health.text()) !== 'ok') fail('health', health.status);
  pass('health', 'ok');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const issued = await issueComfyAccessToken(sb, { userId: USER_ID, mode: 'editor' });
  await putKv(issued.token, USER_ID, issued.expiresAt);
  pass('kv_put', { enter: issued.workUrl });

  // Seed a known graph into CP SoT (simulates prior autosave).
  const marker = `a1-m3-prod-${Date.now()}`;
  const wf = await ensureActiveCpWorkflow(sb, USER_ID);
  const saved = await upsertCpWorkflowDocument(sb, {
    workflowId: wf.id,
    userId: USER_ID,
    document: markerDoc(marker),
    expectedRevision: Number(wf.revision ?? 1),
  });
  pass('cp_seed', { revision: saved.revision, marker, workflowId: wf.id });

  const enter = await fetch(issued.workUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  const setCookie = enter.headers.get('set-cookie') || '';
  if (enter.status !== 302 || !/gvn_comfy=/i.test(setCookie)) {
    fail('enter', { status: enter.status, setCookie: setCookie.slice(0, 80) });
  }
  const cookie = `gvn_comfy=${setCookie.match(/gvn_comfy=([^;]+)/i)[1]}`;
  pass('enter', { location: enter.headers.get('location') });

  const headers = { Cookie: cookie };

  const ext = await fetch(`${WORK}/extensions`, { headers });
  const extJson = await ext.json();
  if (!ext.ok || !extJson.includes('/extensions/gpuvietnam_cp_sync/cp_sync.js')) {
    fail('extensions', extJson);
  }
  pass('extensions', extJson);

  const extJs = await fetch(`${WORK}/extensions/gpuvietnam_cp_sync/cp_sync.js`, {
    headers,
  });
  if (!extJs.ok) fail('ext_js', extJs.status);
  const extText = await extJs.text();
  if (!/REVISION_CONFLICT|Đã lưu Control Plane|gpuvietnam\.cpSync/.test(extText)) {
    fail('ext_js_content', 'missing M3 markers');
  }
  pass('ext_js', { bytes: extText.length });

  const oi = await fetch(`${WORK}/api/object_info`, { headers });
  const oiJson = await oi.json();
  const oiCount = Object.keys(oiJson || {}).length;
  if (!oi.ok || oiCount < 100 || !oiJson.EmptyLatentImage) {
    fail('object_info', { oiCount, hasCore: !!oiJson?.EmptyLatentImage });
  }
  pass('object_info', { oiCount });

  const shell = await fetch(`${WORK}/`, { headers });
  const html = await shell.text();
  if (shell.status !== 200 || !/ComfyUI/i.test(html)) fail('shell', shell.status);
  pass('shell', { bytes: html.length });

  const apiBase = String(
    process.env.A1_CP_ORIGIN ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.GPUVIETNAM_PUBLIC_API_URL ||
      '',
  ).replace(/\/$/, '');

  /** Worker path first; on CF origin errors fall back to apiBase (same as extension). */
  async function cpFetch(token, cookieHeader, init = {}, attempts = 4) {
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(init.headers || {}),
    };
    let last = { status: 0, body: {} };
    for (let i = 0; i < attempts; i += 1) {
      const res = await fetch(`${WORK}/gpuvietnam/cp/sync`, {
        ...init,
        headers: authHeaders,
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json().catch(() => ({}));
      last = { status: res.status, body, via: 'worker' };
      if (res.ok) return last;
      if (![530, 521, 522, 523, 502, 503].includes(res.status)) return last;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
    if (apiBase) {
      const res = await fetch(`${apiBase}/api/cp/comfy-sync`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body, via: 'apiBase' };
    }
    return last;
  }

  // CP sync via Worker path (production)
  const syncGet = await cpFetch(issued.token, cookie);
  if (syncGet.status < 200 || syncGet.status >= 300) {
    fail('cp_sync_get', syncGet);
  }
  const syncBody = syncGet.body;
  const gate = syncBody.workflow?.document?.extra?.gate1;
  if (gate !== marker) fail('cp_sync_restore_seed', { gate, marker });
  pass('cp_sync_get', {
    revision: syncBody.workflow?.revision,
    gate,
    via: syncGet.via,
  });

  // Edit via PATCH through Worker (autosave equivalent)
  const marker2 = `${marker}-edit`;
  const rev = Number(syncBody.workflow?.revision ?? saved.revision);
  const syncPatch = await cpFetch(issued.token, cookie, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId: syncBody.workflow?.workflowId || wf.id,
      document: markerDoc(marker2),
      expectedRevision: rev,
    }),
  });
  if (syncPatch.status < 200 || syncPatch.status >= 300) {
    fail('cp_sync_patch', syncPatch);
  }
  const patchBody = syncPatch.body;
  pass('cp_sync_patch', {
    revision: patchBody.workflow?.revision,
    gate: patchBody.workflow?.document?.extra?.gate1,
    via: syncPatch.via,
  });

  // New session token (close browser simulation)
  const issued2 = await issueComfyAccessToken(sb, { userId: USER_ID, mode: 'editor' });
  await putKv(issued2.token, USER_ID, issued2.expiresAt);
  const enter2 = await fetch(issued2.workUrl, { redirect: 'manual' });
  const setCookie2 = enter2.headers.get('set-cookie') || '';
  if (enter2.status !== 302 || !/gvn_comfy=/i.test(setCookie2)) {
    fail('enter2', { status: enter2.status });
  }
  const cookie2 = `gvn_comfy=${setCookie2.match(/gvn_comfy=([^;]+)/i)[1]}`;
  const sync2 = await cpFetch(issued2.token, cookie2);
  const sync2Body = sync2.body;
  if (
    sync2.status < 200 ||
    sync2.status >= 300 ||
    sync2Body.workflow?.document?.extra?.gate1 !== marker2
  ) {
    fail('restore_new_session', {
      status: sync2.status,
      via: sync2.via,
      gate: sync2Body.workflow?.document?.extra?.gate1,
      marker2,
    });
  }
  pass('restore_new_session', {
    revision: sync2Body.workflow?.revision,
    gate: sync2Body.workflow?.document?.extra?.gate1,
    via: sync2.via,
  });

  const prompt = await fetch(`${WORK}/api/prompt`, {
    method: 'POST',
    headers: { Cookie: cookie2, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: {}, client_id: 'm3-prod' }),
  });
  const promptBody = await prompt.json().catch(() => ({}));
  if (prompt.status !== 503 || promptBody.code !== 'A1_RUNTIME_OFFLINE') {
    fail('prompt_blocked', { status: prompt.status, promptBody });
  }
  pass('prompt_blocked', promptBody);

  // Confirm DB SoT still has newer marker (not lost)
  const db = await getCpWorkflow(sb, USER_ID, wf.id);
  if (db?.document?.extra?.gate1 !== marker2) fail('db_sot', db?.document?.extra);
  pass('db_sot', { revision: db.revision, gate: db.document.extra.gate1 });

  report.verdict = 'PASS';
  report.enterUrl = issued2.workUrl;
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
