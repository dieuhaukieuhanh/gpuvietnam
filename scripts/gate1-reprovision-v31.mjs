/**
 * Gate 1 / ship: destroy current machine (if any) and start a new one using
 * GPUVIETNAM_COMFYUI_IMAGE_V3 (…:v3.1 or …:v3.2).
 * Requires Next API reachable (GATE1_APP_URL or http://127.0.0.1:3000).
 *
 * Usage: node scripts/gate1-reprovision-v31.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  const p = '.env.local';
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
    const k = t.slice(0, i).trim();
    process.env[k] = v;
  }
}

loadEnv();

const USER_ID = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
// Prefer local Next for Gate 1 (tunnel may lag behind restarts).
const APP = process.env.GATE1_APP_URL || 'http://127.0.0.1:3000';

const image = process.env.GPUVIETNAM_COMFYUI_IMAGE_V3 || '';
console.log('APP', APP);
console.log('GPUVIETNAM_COMFYUI_IMAGE_V3', image);
if (!/:(v3\.1|v3\.2)\b/.test(image)) {
  console.error('Refuse: GPUVIETNAM_COMFYUI_IMAGE_V3 must be …:v3.1 or …:v3.2');
  process.exit(1);
}

const sbAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
// verifyOtp must not attach a user session onto the service-role client
const sbAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data: userRow, error: userErr } = await sbAdmin
  .from('users')
  .select('id,email')
  .eq('id', USER_ID)
  .maybeSingle();
if (userErr || !userRow?.email) {
  console.error('user lookup failed', userErr?.message);
  process.exit(1);
}

const { data: linkData, error: linkErr } = await sbAdmin.auth.admin.generateLink({
  type: 'magiclink',
  email: userRow.email,
});
if (linkErr) {
  console.error('generateLink', linkErr.message);
  process.exit(1);
}
const tokenHash = linkData?.properties?.hashed_token;
if (!tokenHash) {
  console.error('no hashed_token from generateLink', linkData);
  process.exit(1);
}

const { data: otpData, error: otpErr } = await sbAuth.auth.verifyOtp({
  token_hash: tokenHash,
  type: 'email',
});
if (otpErr || !otpData?.session?.access_token) {
  console.error('verifyOtp', otpErr?.message || 'no session');
  process.exit(1);
}
const accessToken = otpData.session.access_token;
console.log('auth OK');

const { data: machines } = await sbAdmin
  .from('machines')
  .select('id,status,instance_id,image')
  .eq('user_id', USER_ID)
  .in('status', ['running', 'stopping', 'opening', 'provisioning', 'creating', 'starting'])
  .limit(5);
console.log('active machines', machines);

async function api(path, method, body) {
  const res = await fetch(`${APP.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

if (machines?.length) {
  console.log('destroying…');
  const destroy = await api('/api/machines/destroy', 'POST', {
    forceStop: true,
    reason: 'gate1_v31_reprovision',
  });
  console.log('destroy', destroy.status, JSON.stringify(destroy.json).slice(0, 800));
  // wait for idle
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const { data: m } = await sbAdmin
      .from('machines')
      .select('id,status')
      .eq('user_id', USER_ID)
      .in('status', ['running', 'stopping', 'opening', 'provisioning', 'creating', 'starting'])
      .limit(5);
    console.log('poll active', m);
    if (!m?.length) break;
  }
}

const { data: inv, error: invErr } = await sbAdmin
  .from('user_plan_inventory')
  .select('id,plan_name,is_active,subscription_id,hours_remaining,status')
  .eq('user_id', USER_ID)
  .eq('status', 'active')
  .limit(20);
console.log('inventory', invErr?.message || inv);

const ranked = (inv || [])
  .filter((r) => Number(r.hours_remaining) > 0.2)
  .sort((a, b) => Number(b.hours_remaining) - Number(a.hours_remaining));
const active =
  ranked.find((r) => r.is_active) ||
  ranked.find((r) => /pro/i.test(String(r.plan_name || ''))) ||
  ranked.find((r) => /starter/i.test(String(r.plan_name || ''))) ||
  ranked[0];
if (!active) {
  console.error('no plan inventory with remaining hours');
  process.exit(1);
}

console.log('starting with', active);
const start = await api('/api/user/start-machine', 'POST', {
  inventoryId: active.id,
  plan: active.plan_name,
  subscriptionId: active.subscription_id,
});
console.log('start', start.status, JSON.stringify(start.json).slice(0, 1200));

for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const q = await sbAdmin
    .from('machines')
    .select('id,status,image,instance_id,ip_address,ssh_ok,created_at')
    .eq('user_id', USER_ID)
    .order('created_at', { ascending: false })
    .limit(1);
  const m = q.data?.[0] ?? null;
  console.log('machine poll', m);
  const tagOk = /:(v3\.1|v3\.2)\b/.test(String(m?.image || ''));
  if (m?.status === 'running' && tagOk) {
    console.log('REPROVISION_OK', m);
    process.exit(0);
  }
  if (m?.status === 'running' && !tagOk) {
    console.error('REPROVISION_WRONG_IMAGE', m.image);
    process.exit(2);
  }
  if (['failed', 'error', 'destroyed'].includes(String(m?.status)) && i > 3) {
    // keep waiting if destroyed mid-start
  }
}

console.error('REPROVISION_TIMEOUT');
process.exit(3);
