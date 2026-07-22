/**
 * A0.5 scenario harness (API + browser CDP via fetch checks + optional Playwright-less eval via lab).
 *
 * Proves:
 *  1) Lab serves FE + stubs without Runtime
 *  2) object_info offline catalog
 *  3) /prompt → 503 Runtime offline
 *  4) CP save/load roundtrip with a synthetic LiteGraph document
 *  5) Browser load (if A05_BROWSER=1 and cursor browser available — uses fetch health)
 *
 * Usage:
 *   node labs/a0.5-editor-without-runtime/run-scenarios.mjs
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
const LAB = process.env.A05_LAB_URL || 'http://127.0.0.1:5190';
const APP = process.env.GATE1_APP_URL || process.env.A05_CP_ORIGIN || 'http://127.0.0.1:3000';
const USER_ID = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const WORKFLOW_ID = process.env.GATE1_WORKFLOW_ID || 'f287ec3d-f268-4ddb-a0cd-460deec8e5bf';
const MARKER = `a05-lab-${Date.now()}`;
const resultsDir = join(here, 'results');
mkdirSync(resultsDir, { recursive: true });

function loadEnv() {
  const p = join(here, '../../.env.local');
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

const results = {
  startedAt: new Date().toISOString(),
  scenarios: {},
};

function pass(id, detail) {
  results.scenarios[id] = { status: 'PASS', detail };
  console.log('PASS', id, detail);
}
function fail(id, detail) {
  results.scenarios[id] = { status: 'FAIL', detail };
  console.error('FAIL', id, detail);
}

async function lab(path, init) {
  const res = await fetch(`${LAB.replace(/\/$/, '')}${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });
  const ct = res.headers.get('content-type') || '';
  let body;
  if (ct.includes('json')) body = await res.json().catch(() => null);
  else body = await res.text();
  return { status: res.status, body, ct };
}

// S1 — health + static FE
{
  const h = await lab('/lab/health');
  if (h.status === 200 && h.body?.ok && h.body.offlineNodes > 0) {
    pass('S1_lab_health', h.body);
  } else fail('S1_lab_health', h);
}

// S2 — index.html loads (editor shell)
{
  const idx = await lab('/');
  const html = typeof idx.body === 'string' ? idx.body : '';
  if (idx.status === 200 && /ComfyUI/i.test(html) && /a05_bridge/.test(html)) {
    pass('S2_editor_shell', { bytes: html.length, hasBridge: true });
  } else fail('S2_editor_shell', { status: idx.status, slice: html.slice(0, 200) });
}

// S3 — mandatory boot stubs
{
  const settings = await lab('/api/settings');
  const oi = await lab('/api/object_info');
  const ext = await lab('/api/extensions');
  const stats = await lab('/api/system_stats');
  const users = await lab('/api/users');
  const ok =
    settings.status === 200 &&
    oi.status === 200 &&
    typeof oi.body === 'object' &&
    oi.body.CheckpointLoaderSimple &&
    oi.body.KSampler &&
    ext.status === 200 &&
    Array.isArray(ext.body) &&
    ext.body.length === 0 &&
    stats.status === 200 &&
    stats.body?.a05?.runtimeOnline === false &&
    users.status === 200;
  if (ok) {
    pass('S3_boot_stubs', {
      nodes: Object.keys(oi.body).length,
      extensions: ext.body.length,
      runtimeOnline: stats.body.a05.runtimeOnline,
    });
  } else {
    fail('S3_boot_stubs', {
      settings: settings.status,
      oi: oi.status,
      hasKSampler: Boolean(oi.body?.KSampler),
      ext: ext.status,
      stats: stats.status,
    });
  }
}

// S4 — Generate blocked when Runtime offline
{
  const prompt = await lab('/api/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: {
        '1': {
          class_type: 'EmptyImage',
          inputs: { width: 64, height: 64, batch_size: 1, color: 0 },
        },
        '2': {
          class_type: 'PreviewImage',
          inputs: { images: ['1', 0] },
        },
      },
      client_id: 'a05-harness',
    }),
  });
  if (
    prompt.status === 503 &&
    /Runtime chưa sẵn sàng|A05_RUNTIME_OFFLINE/i.test(JSON.stringify(prompt.body))
  ) {
    pass('S4_generate_blocked', prompt.body);
  } else fail('S4_generate_blocked', prompt);
}

// S5 — queue/history soft empty
{
  const q = await lab('/api/queue');
  const h = await lab('/api/history');
  if (
    q.status === 200 &&
    Array.isArray(q.body?.queue_running) &&
    h.status === 200 &&
    typeof h.body === 'object'
  ) {
    pass('S5_queue_history_soft', { queue: q.body, historyKeys: Object.keys(h.body || {}) });
  } else fail('S5_queue_history_soft', { q: q.status, h: h.status });
}

// S6 — CP save + reload persistence (Control Plane)
{
  try {
    const sbAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const sbAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: userRow } = await sbAdmin.from('users').select('email').eq('id', USER_ID).maybeSingle();
    const { data: linkData } = await sbAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: userRow.email,
    });
    const { data: otpData, error: otpErr } = await sbAuth.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'email',
    });
    if (otpErr) throw otpErr;
    const token = otpData.session.access_token;

    const document = {
      last_node_id: 3,
      last_link_id: 1,
      nodes: [
        {
          id: 1,
          type: 'Note',
          pos: [80, 80],
          size: [240, 80],
          flags: {},
          order: 0,
          mode: 0,
          title: MARKER,
          properties: { text: MARKER },
          widgets_values: [MARKER],
        },
        {
          id: 2,
          type: 'EmptyLatentImage',
          pos: [80, 200],
          size: [280, 110],
          flags: {},
          order: 1,
          mode: 0,
          inputs: [],
          outputs: [{ name: 'LATENT', type: 'LATENT', links: [1], slot_index: 0 }],
          properties: {},
          widgets_values: [512, 512, 1],
        },
        {
          id: 3,
          type: 'KSampler',
          pos: [420, 180],
          size: [300, 260],
          flags: {},
          order: 2,
          mode: 0,
          inputs: [
            { name: 'model', type: 'MODEL', link: null },
            { name: 'positive', type: 'CONDITIONING', link: null },
            { name: 'negative', type: 'CONDITIONING', link: null },
            { name: 'latent_image', type: 'LATENT', link: 1 },
          ],
          outputs: [{ name: 'LATENT', type: 'LATENT', links: null, slot_index: 0 }],
          properties: {},
          widgets_values: [42, 'fixed', 4, 5, 'euler', 'normal', 1],
        },
      ],
      links: [[1, 2, 0, 3, 3, 'LATENT']],
      groups: [],
      config: {},
      extra: { a05: MARKER, gate1: MARKER },
      version: 0.4,
    };

    // Prefer lab CP proxy (same-origin path) then direct Next
    async function patch(url) {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workflowId: WORKFLOW_ID, document }),
      });
      return { status: res.status, json: await res.json().catch(() => ({})) };
    }

    let saved = await patch(`${LAB}/lab/cp/api/cp/comfy-sync`);
    if (saved.status !== 200) {
      saved = await patch(`${APP.replace(/\/$/, '')}/api/cp/comfy-sync`);
    }
    const markerSaved = saved.json?.workflow?.document?.extra?.a05;
    const rev = saved.json?.workflow?.revision;

    const getRes = await fetch(
      `${APP.replace(/\/$/, '')}/api/cp/comfy-sync?workflowId=${encodeURIComponent(WORKFLOW_ID)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const got = await getRes.json().catch(() => ({}));
    const markerGot = got?.workflow?.document?.extra?.a05;
    const hasNodes = Array.isArray(got?.workflow?.document?.nodes)
      ? got.workflow.document.nodes.length >= 2
      : false;

    if (saved.status === 200 && markerSaved === MARKER && markerGot === MARKER && hasNodes) {
      pass('S6_cp_save_reload', {
        revision: rev,
        marker: markerGot,
        nodeCount: got.workflow.document.nodes.length,
        via: saved.json?.workflow ? 'ok' : '?',
      });
    } else {
      fail('S6_cp_save_reload', { saved, getStatus: getRes.status, markerGot, hasNodes });
    }
  } catch (e) {
    fail('S6_cp_save_reload', e instanceof Error ? e.message : String(e));
  }
}

// S7 — FE asset + core extension path exists on disk (bundled)
{
  const fe =
    process.env.A05_FE_STATIC ||
    join(here, '../../../ComfyUI/.venv/Lib/site-packages/comfyui_frontend_package/static');
  const indexOk = existsSync(join(fe, 'index.html'));
  const assetsOk = existsSync(join(fe, 'assets'));
  const extOk = existsSync(join(fe, 'extensions'));
  if (indexOk && assetsOk && extOk) {
    pass('S7_fe_package_on_disk', { fe });
  } else fail('S7_fe_package_on_disk', { fe, indexOk, assetsOk, extOk });
}

const failed = Object.values(results.scenarios).filter((s) => s.status === 'FAIL');
results.finishedAt = new Date().toISOString();
results.verdictHarness =
  failed.length === 0 ? 'HARNESS_PASS' : `HARNESS_FAIL (${failed.length})`;

const out = join(resultsDir, `a05-scenarios-${Date.now()}.json`);
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ verdictHarness: results.verdictHarness, out, scenarios: results.scenarios }, null, 2));
process.exit(failed.length ? 1 : 0);
