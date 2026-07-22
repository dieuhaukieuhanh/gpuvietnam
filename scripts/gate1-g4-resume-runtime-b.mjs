/**
 * Resume G4 after provider kill already done: start Runtime B, verify CP marker + G5.
 * Usage: node scripts/gate1-g4-resume-runtime-b.mjs
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
const MACHINE_A = process.env.GATE1_MACHINE_A || '4336f5fb-b790-4952-a61a-dfd3143ab1ec';
const ORDER_A = process.env.GATE1_ORDER_A || '1970310';
const MARKER = process.env.GATE1_MARKER || 'gate1-1784652249438';
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

const syncBefore = await api(`/api/cp/comfy-sync?workflowId=${encodeURIComponent(WORKFLOW_ID)}`);
const markerBefore = syncBefore.json?.workflow?.document?.extra?.gate1 || MARKER;
console.log('CP', { revision: syncBefore.json?.workflow?.revision, marker: markerBefore });

const restoreApi = await api(
  `/api/cp/session-restore?workflowId=${encodeURIComponent(WORKFLOW_ID)}`,
);
const restore = restoreApi.json?.restore ?? {};
console.log('G5', {
  status: restoreApi.status,
  restoreKind: restore.restoreKind,
  jobResumed: restore.jobResumed,
  projectContinues: restore.projectContinues,
  message: restore.message,
});
const g5 =
  restoreApi.status === 200 &&
  restore.restoreKind === 'session' &&
  restore.jobResumed === false &&
  restore.projectContinues === true &&
  !/resume CUDA/i.test(String(restore.message || ''));

// Ensure no stale active machine
await sbAdmin
  .from('machines')
  .update({
    status: 'destroyed',
    updated_at: new Date().toISOString(),
    projection_message: 'gate1 G4: provider order cancelled',
  })
  .eq('id', MACHINE_A)
  .neq('status', 'destroyed');

await sbAdmin
  .from('subscriptions')
  .update({ server_status: 'offline' })
  .eq('user_id', USER_ID)
  .in('server_status', ['online', 'provisioning']);

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
  ranked.find((r) => /starter|pro/i.test(String(r.plan_name || ''))) ||
  ranked[0];
if (!plan) {
  console.error('FAIL no plan');
  process.exit(1);
}

console.log('start Runtime B', plan);
const start = await api('/api/user/start-machine', {
  method: 'POST',
  body: {
    inventoryId: plan.id,
    plan: plan.plan_name,
    subscriptionId: plan.subscription_id,
  },
});
console.log('start', start.status, JSON.stringify(start.json).slice(0, 800));

let machineB = null;
for (let i = 0; i < 72; i++) {
  await sleep(10000);
  const q = await sbAdmin
    .from('machines')
    .select('id,status,image,instance_id,ip_address,port,projection_verified_at,ssh_ok')
    .eq('user_id', USER_ID)
    .order('created_at', { ascending: false })
    .limit(1);
  machineB = q.data?.[0] ?? null;
  console.log('poll', {
    id: machineB?.id,
    status: machineB?.status,
    image: machineB?.image,
    order: machineB?.instance_id,
    ssh_ok: machineB?.ssh_ok,
  });
  if (
    machineB?.status === 'running' &&
    String(machineB.image || '').includes(':v3.1') &&
    machineB.id !== MACHINE_A
  ) {
    break;
  }
}

if (!machineB || machineB.status !== 'running' || machineB.id === MACHINE_A) {
  console.error('FAIL Runtime B', machineB);
  process.exit(1);
}

try {
  const host = machineB.ip_address;
  const probeUrl = machineB.port === 443 ? `https://${host}/` : `http://${host}:${machineB.port}/`;
  const probe = await fetch(probeUrl, { method: 'GET', signal: AbortSignal.timeout(20000) });
  console.log('probe', probe.status, probeUrl);
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
  console.warn('probe failed', e instanceof Error ? e.message : e);
}

let access = { status: 0, json: {} };
for (let i = 0; i < 24; i++) {
  access = await api('/api/session/comfy-access', { method: 'POST' });
  console.log('comfy-access', i + 1, access.status, access.json?.error || 'ok');
  if (access.status === 200 && access.json.workUrl) break;
  await sleep(5000);
}

const syncAfter = await api(`/api/cp/comfy-sync?workflowId=${encodeURIComponent(WORKFLOW_ID)}`);
const markerAfter = syncAfter.json?.workflow?.document?.extra?.gate1;
const g4 =
  machineB.id !== MACHINE_A &&
  markerAfter === markerBefore &&
  access.status === 200;
const g6 = markerAfter === markerBefore;

console.log(
  JSON.stringify(
    {
      G4_kill_provider_restore: g4 ? 'PASS' : 'FAIL',
      G5_session_restore_api: g5 ? 'PASS' : 'FAIL',
      G6_graph_restore: g6 ? 'PASS' : 'FAIL',
      orderA_killed: ORDER_A,
      machineA: MACHINE_A,
      machineB: machineB.id,
      orderB: machineB.instance_id,
      imageB: machineB.image,
      markerBefore,
      markerAfter,
      workUrlB: access.json?.workUrl ?? null,
      sessionRestoreMessage: restore.message,
    },
    null,
    2,
  ),
);

process.exit(g4 && g5 && g6 ? 0 : 1);
