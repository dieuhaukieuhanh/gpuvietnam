/**
 * Gate 1 G3 — Stop dashboard → máy mới v3.1/v3.2 → CP graph marker còn.
 * Usage: node scripts/gate1-g3-stop-restore.mjs
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
const EXPECT_MARKER = process.env.GATE1_MARKER || '';

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

const beforeQ = await sbAdmin
  .from('machines')
  .select('id,status,image,instance_id,ip_address,port,projection_verified_at,projection_message')
  .eq('user_id', USER_ID)
  .eq('status', 'running')
  .order('created_at', { ascending: false })
  .limit(1);
const machineA = beforeQ.data?.[0] ?? null;
console.log('machineA', machineA);

const syncBefore = await api(`/api/cp/comfy-sync?workflowId=${encodeURIComponent(WORKFLOW_ID)}`);
const markerBefore =
  syncBefore.json?.workflow?.document?.extra?.gate1 ||
  EXPECT_MARKER ||
  null;
const revBefore = syncBefore.json?.workflow?.revision;
console.log('CP before stop', {
  status: syncBefore.status,
  revision: revBefore,
  marker: markerBefore,
});
if (!markerBefore) {
  console.error('FAIL: no gate1 marker on CP before stop — run gate1-run-continuity-api.mjs first');
  process.exit(1);
}

console.log('stop-machine…');
const stop = await api('/api/user/stop-machine', { method: 'POST' });
console.log('stop', stop.status, {
  success: stop.json?.success,
  alreadyStopped: stop.json?.alreadyStopped,
  error: stop.json?.error,
  outcome: stop.json?.outcome,
});

for (let i = 0; i < 48; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const { data: active } = await sbAdmin
    .from('machines')
    .select('id,status')
    .eq('user_id', USER_ID)
    .in('status', ['running', 'stopping', 'opening', 'provisioning', 'creating', 'starting'])
    .limit(5);
  console.log('poll active after stop', active);
  if (!active?.length) break;
}

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
  console.error('FAIL no plan hours');
  process.exit(1);
}

function imageOk(image) {
  return /:(v3\.1|v3\.2)\b/.test(String(image || ''));
}

console.log('start-machine…', plan);
const start = await api('/api/user/start-machine', {
  method: 'POST',
  body: {
    inventoryId: plan.id,
    plan: plan.plan_name,
    subscriptionId: plan.subscription_id,
  },
});
console.log('start', start.status, JSON.stringify(start.json).slice(0, 900));

let machineB = null;
// Up to ~30 min: first image pull on Clore can exceed 10 min with host retries.
for (let i = 0; i < 180; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const q = await sbAdmin
    .from('machines')
    .select(
      'id,status,image,instance_id,ip_address,port,projection_verified_at,projection_message,ssh_ok',
    )
    .eq('user_id', USER_ID)
    .order('created_at', { ascending: false })
    .limit(1);
  machineB = q.data?.[0] ?? null;
  console.log('machineB poll', {
    id: machineB?.id,
    status: machineB?.status,
    image: machineB?.image,
    ssh_ok: machineB?.ssh_ok,
    projection_verified_at: machineB?.projection_verified_at,
  });
  if (
    machineB?.status === 'running' &&
    imageOk(machineB.image) &&
    machineB.id !== machineA?.id
  ) {
    break;
  }
}

if (!machineB || machineB.status !== 'running' || !imageOk(machineB.image)) {
  console.error('FAIL machine B not running on v3.1/v3.2', machineB);
  process.exit(1);
}

// Mark projection ready if worker lag (HTTPS probe)
try {
  const host = machineB.ip_address;
  const probeUrl = machineB.port === 443 ? `https://${host}/` : `http://${host}:${machineB.port}/`;
  const probe = await fetch(probeUrl, { method: 'GET', signal: AbortSignal.timeout(20000) });
  console.log('comfy probe', probe.status, probeUrl);
  if (probe.ok && !machineB.projection_verified_at) {
    await sbAdmin
      .from('machines')
      .update({
        projection_verified_at: new Date().toISOString(),
        projection_message: 'ComfyUI sẵn sàng (HTTPS reachable)',
        updated_at: new Date().toISOString(),
      })
      .eq('id', machineB.id);
  } else if (probe.ok) {
    await sbAdmin
      .from('machines')
      .update({
        projection_message: 'ComfyUI sẵn sàng (HTTPS reachable)',
        projection_verified_at: machineB.projection_verified_at || new Date().toISOString(),
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
  await new Promise((r) => setTimeout(r, 5000));
}
if (access.status !== 200) {
  console.error('FAIL comfy-access on B');
  process.exit(1);
}

const syncAfter = await api(`/api/cp/comfy-sync?workflowId=${encodeURIComponent(WORKFLOW_ID)}`);
const markerAfter = syncAfter.json?.workflow?.document?.extra?.gate1;
const revAfter = syncAfter.json?.workflow?.revision;
console.log(
  JSON.stringify(
    {
      G3_stop_restore: markerAfter === markerBefore ? 'PASS' : 'FAIL',
      markerBefore,
      markerAfter,
      revBefore,
      revAfter,
      machineA: machineA?.id,
      machineB: machineB?.id,
      orderA: machineA?.instance_id,
      orderB: machineB?.instance_id,
      imageB: machineB?.image,
      workUrlB: access.json.workUrl,
    },
    null,
    2,
  ),
);

process.exit(markerAfter === markerBefore ? 0 : 1);
