/**
 * Gate 1 G4+G6 — Kill Provider order (not dashboard Stop) → Runtime C → CP graph còn.
 * Also probes G5 Session Restore API (banner payload).
 *
 * Usage: node scripts/gate1-g4-kill-provider.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
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

const USER_ID = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const APP = process.env.GATE1_APP_URL || 'http://127.0.0.1:3000';
const WORKFLOW_ID = process.env.GATE1_WORKFLOW_ID || 'f287ec3d-f268-4ddb-a0cd-460deec8e5bf';
const CLORE_BASE = 'https://api.clore.ai/v1';
const cloreKey = (process.env.CLORE_API_KEY || process.env.CLORE_AI_KEY || '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${APP.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function clore(method, path, body) {
  const init = {
    method,
    headers: { Accept: 'application/json', auth: cloreKey },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(CLORE_BASE + path, init);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const beforeQ = await sbAdmin
  .from('machines')
  .select('id,status,image,instance_id,ip_address,port,projection_verified_at')
  .eq('user_id', USER_ID)
  .eq('status', 'running')
  .order('created_at', { ascending: false })
  .limit(1);
const machineA = beforeQ.data?.[0] ?? null;
console.log('runtimeA', machineA);
if (!machineA?.instance_id) {
  console.error('FAIL no running machine to kill');
  process.exit(1);
}

const syncBefore = await api(`/api/cp/comfy-sync?workflowId=${encodeURIComponent(WORKFLOW_ID)}`);
const markerBefore = syncBefore.json?.workflow?.document?.extra?.gate1;
const revBefore = syncBefore.json?.workflow?.revision;
console.log('CP before kill', { status: syncBefore.status, revision: revBefore, marker: markerBefore });
if (!markerBefore) {
  console.error('FAIL no gate1 marker — run gate1-run-continuity-api.mjs first');
  process.exit(1);
}

const orderId = Number(machineA.instance_id);
console.log('Clore cancel_order', orderId, '(provider kill — not dashboard Stop)');
await sleep(1500);
let cancel = await clore('POST', '/cancel_order', { id: orderId });
console.log('cancel', cancel.status, cancel.json);
if (cancel.status === 429 || cancel.json?.code === 5) {
  await sleep(5000);
  cancel = await clore('POST', '/cancel_order', { id: orderId });
  console.log('cancel retry', cancel.status, cancel.json);
}

let orderGone = false;
for (let i = 0; i < 24; i++) {
  await sleep(5000);
  const orders = await clore('GET', '/my_orders');
  const list = Array.isArray(orders.json?.orders) ? orders.json.orders : [];
  const still = list.find((o) => Number(o.id ?? o.order_id) === orderId);
  console.log('my_orders poll', { status: orders.status, count: list.length, still: Boolean(still) });
  if (!still && orders.status === 200) {
    orderGone = true;
    break;
  }
}
console.log('orderGone', orderGone);

// Local lifecycle converge: mark destroyed after provider kill confirmed
// (dashboard Stop intentionally NOT used — this mirrors reconcile after external cancel)
const { error: destroyErr } = await sbAdmin
  .from('machines')
  .update({
    status: 'destroyed',
    updated_at: new Date().toISOString(),
    projection_message: 'gate1 G4: provider order cancelled',
  })
  .eq('id', machineA.id);
if (destroyErr) {
  console.error('FAIL local destroy mark', destroyErr.message);
  process.exit(1);
}
console.log('local destroy mark OK', machineA.id);

await sbAdmin
  .from('subscriptions')
  .update({ server_status: 'offline' })
  .eq('user_id', USER_ID)
  .eq('status', 'active');

const restoreApi = await api(
  `/api/cp/session-restore?workflowId=${encodeURIComponent(WORKFLOW_ID)}`,
);
const restore = restoreApi.json?.restore ?? restoreApi.json ?? {};
console.log('G5 session-restore API', restoreApi.status, {
  restoreKind: restore?.restoreKind,
  jobResumed: restore?.jobResumed,
  projectContinues: restore?.projectContinues,
  message: restore?.message,
  workflow: restore?.workflow,
});

const g5 =
  restoreApi.status === 200 &&
  restore?.restoreKind === 'session' &&
  restore?.jobResumed === false &&
  restore?.projectContinues === true &&
  !/resume CUDA/i.test(String(restore?.message || ''));

const { data: inv } = await sbAdmin
  .from('user_plan_inventory')
  .select('id,plan_name,is_active,subscription_id,hours_remaining,status')
  .eq('user_id', USER_ID)
  .eq('status', 'active')
  .limit(20);
const ranked = (inv || [])
  .filter((r) => Number(r.hours_remaining) > 0.2)
  .sort((a, b) => Number(b.hours_remaining) - Number(a.hours_remaining));
const plan =
  ranked.find((r) => r.is_active) ||
  ranked.find((r) => /pro/i.test(String(r.plan_name || ''))) ||
  ranked.find((r) => /starter/i.test(String(r.plan_name || ''))) ||
  ranked[0];
if (!plan) {
  console.error('FAIL no plan hours for Runtime B');
  process.exit(1);
}

function imageOk(image) {
  return /:(v3\.1|v3\.2)\b/.test(String(image || ''));
}

console.log('start Runtime B…', plan);
const start = await api('/api/user/start-machine', {
  method: 'POST',
  body: {
    inventoryId: plan.id,
    plan: plan.plan_name,
    subscriptionId: plan.subscription_id,
  },
});
console.log('start', start.status, JSON.stringify(start.json).slice(0, 700));

let machineB = null;
for (let i = 0; i < 180; i++) {
  await sleep(10000);
  const q = await sbAdmin
    .from('machines')
    .select('id,status,image,instance_id,ip_address,port,projection_verified_at,ssh_ok')
    .eq('user_id', USER_ID)
    .order('created_at', { ascending: false })
    .limit(1);
  machineB = q.data?.[0] ?? null;
  console.log('runtimeB poll', {
    id: machineB?.id,
    status: machineB?.status,
    image: machineB?.image,
    order: machineB?.instance_id,
    ssh_ok: machineB?.ssh_ok,
  });
  if (
    machineB?.status === 'running' &&
    imageOk(machineB.image) &&
    machineB.id !== machineA.id
  ) {
    break;
  }
}

if (!machineB || machineB.status !== 'running') {
  console.error('FAIL Runtime B not running', machineB);
  process.exit(1);
}

try {
  const host = machineB.ip_address;
  const probeUrl = machineB.port === 443 ? `https://${host}/` : `http://${host}:${machineB.port}/`;
  const probe = await fetch(probeUrl, { method: 'GET', signal: AbortSignal.timeout(20000) });
  console.log('comfy probe B', probe.status, probeUrl);
  if (probe.ok) {
    await sbAdmin
      .from('machines')
      .update({
        projection_verified_at: new Date().toISOString(),
        projection_message: 'ComfyUI sẵn sàng (HTTPS reachable)',
        updated_at: new Date().toISOString(),
      })
      .eq('id', machineB.id);
  }
} catch (e) {
  console.warn('probe B failed', e instanceof Error ? e.message : e);
}

let access = { status: 0, json: {} };
for (let i = 0; i < 24; i++) {
  access = await api('/api/session/comfy-access', { method: 'POST' });
  console.log('comfy-access B', i + 1, access.status, access.json?.error || 'ok');
  if (access.status === 200 && access.json.workUrl) break;
  await sleep(5000);
}

const syncAfter = await api(`/api/cp/comfy-sync?workflowId=${encodeURIComponent(WORKFLOW_ID)}`);
const markerAfter = syncAfter.json?.workflow?.document?.extra?.gate1;
const revAfter = syncAfter.json?.workflow?.revision;

// G6 lightweight: ensure active workflow inject payload still carries marker (graph restore)
// Full pixel Generate needs a Checkpoint workflow — recorded separately if attempted.
const g4 =
  orderGone &&
  machineB.id !== machineA.id &&
  markerAfter === markerBefore &&
  access.status === 200;
const g6_graph_restore = markerAfter === markerBefore && Boolean(syncAfter.json?.workflow?.document);

console.log(
  JSON.stringify(
    {
      G4_kill_provider_restore: g4 ? 'PASS' : 'FAIL',
      G5_session_restore_api: g5 ? 'PASS' : 'FAIL',
      G6_graph_restore: g6_graph_restore ? 'PASS' : 'FAIL',
      G6_generate_note:
        'Pixel Generate (Checkpoint → output) still needs interactive Comfy run on restored graph',
      markerBefore,
      markerAfter,
      revBefore,
      revAfter,
      machineA: machineA.id,
      orderA: String(orderId),
      machineB: machineB.id,
      orderB: machineB.instance_id,
      imageB: machineB.image,
      workUrlB: access.json?.workUrl ?? null,
      sessionRestore: {
        restoreKind: restore?.restoreKind,
        jobResumed: restore?.jobResumed,
        projectContinues: restore?.projectContinues,
        message: restore?.message,
      },
    },
    null,
    2,
  ),
);

process.exit(g4 && g5 && g6_graph_restore ? 0 : 1);
