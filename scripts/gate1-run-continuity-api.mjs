/**
 * Gate 1 Continuity — API-assisted checks on live v3.1 machine.
 * G1 UI indicator still needs browser; this proves CP SoT + comfy-token sync path.
 */
import { readFileSync, existsSync } from 'fs';
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
const MARKER = `gate1-${Date.now()}`;

const sbAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
// Separate client for OTP — verifyOtp must not attach a user session onto the service-role client
// (that would override the service key and break RLS-bypassing machine reads).
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
const userJwt = otpData.session.access_token;

async function api(path, { method = 'GET', token, body } = {}) {
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

const machineQuery = await sbAdmin
  .from('machines')
  .select('id,status,image,instance_id,ip_address,port,projection_verified_at')
  .eq('user_id', USER_ID)
  .eq('status', 'running')
  .order('created_at', { ascending: false })
  .limit(1);
if (machineQuery.error) {
  console.error('machine query error', machineQuery.error);
}
const machine = Array.isArray(machineQuery.data) ? machineQuery.data[0] ?? null : machineQuery.data;
console.log('machine', machine);

let access = { status: 0, json: {} };
for (let i = 0; i < 30; i++) {
  access = await api('/api/session/comfy-access', { method: 'POST', token: userJwt });
  console.log('comfy-access try', i + 1, access.status, access.json?.error || access.json?.code || 'ok');
  if (access.status === 200 && access.json.workUrl) break;
  await new Promise((r) => setTimeout(r, 5000));
}
console.log('comfy-access', access.status, {
  workUrl: access.json.workUrl,
  cpSync: access.json.cpSync,
  expiresAt: access.json.expiresAt,
  error: access.json.error,
});
if (access.status !== 200 || !access.json.workUrl) {
  console.error('FAIL comfy-access');
  process.exit(1);
}

const workUrl = String(access.json.workUrl);
const tokenMatch = workUrl.match(/\/enter\/([^?#]+)/);
const comfyToken = tokenMatch ? decodeURIComponent(tokenMatch[1].split('#')[0]) : null;
if (!comfyToken?.startsWith('gvc.')) {
  console.error('FAIL no gvc token in workUrl');
  process.exit(1);
}

const doc = {
  last_node_id: 1,
  last_link_id: 0,
  nodes: [
    {
      id: 1,
      type: 'Note',
      pos: [100, 100],
      size: [210, 80],
      flags: {},
      order: 0,
      mode: 0,
      title: MARKER,
      properties: { text: MARKER },
      widgets_values: [MARKER],
    },
  ],
  links: [],
  groups: [],
  config: {},
  extra: { gate1: MARKER },
  version: 0.4,
};

const patch = await api('/api/cp/comfy-sync', {
  method: 'PATCH',
  token: comfyToken,
  body: {
    workflowId: access.json.cpSync?.workflowId,
    document: doc,
  },
});
console.log('PATCH comfy-sync', patch.status, {
  workflowId: patch.json?.workflow?.workflowId,
  revision: patch.json?.workflow?.revision,
  inject: patch.json?.workflow?.inject,
  marker: patch.json?.workflow?.document?.extra?.gate1,
});

if (patch.status !== 200 || patch.json?.workflow?.document?.extra?.gate1 !== MARKER) {
  console.error('FAIL G1 sync path');
  process.exit(1);
}

const get1 = await api(
  `/api/cp/comfy-sync?workflowId=${encodeURIComponent(patch.json.workflow.workflowId)}`,
  { token: comfyToken },
);
console.log('GET after save', get1.status, {
  revision: get1.json?.workflow?.revision,
  marker: get1.json?.workflow?.document?.extra?.gate1,
});

// G2 SoT: fresh auth context, no browser storage — only CP
const get2 = await api(
  `/api/cp/comfy-sync?workflowId=${encodeURIComponent(patch.json.workflow.workflowId)}`,
  { token: userJwt },
);
console.log('GET via user JWT (SoT)', get2.status, {
  revision: get2.json?.workflow?.revision,
  marker: get2.json?.workflow?.document?.extra?.gate1,
});

const g1 = patch.status === 200 && get1.json?.workflow?.document?.extra?.gate1 === MARKER;
const g2 = get2.json?.workflow?.document?.extra?.gate1 === MARKER;

console.log(
  JSON.stringify(
    {
      G1_sync_path: g1 ? 'PASS' : 'FAIL',
      G2_sot_api: g2 ? 'PASS' : 'FAIL',
      note: 'G1 UI indicator + G3/G4+G6/G5 still need interactive / provider kill steps',
      workflowId: patch.json.workflow.workflowId,
      revision: patch.json.workflow.revision,
      marker: MARKER,
      workUrl,
      machineId: machine?.id ?? null,
      image: machine?.image ?? null,
    },
    null,
    2,
  ),
);

process.exit(g1 && g2 ? 0 : 1);
