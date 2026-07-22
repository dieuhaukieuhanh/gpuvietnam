/**
 * Mint A1 editor-only session (upstream=null) and print workUrl.
 * Usage: node scripts/a1-m1-mint-editor-session.mjs
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

const res = await fetch(`${APP.replace(/\/$/, '')}/api/session/comfy-access`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ mode: 'editor' }),
});
const json = await res.json().catch(() => ({}));
console.log(
  JSON.stringify(
    {
      status: res.status,
      mode: json.mode,
      runtimeOnline: json.runtimeOnline,
      workUrl: json.workUrl ? String(json.workUrl).split('#')[0] : null,
      expiresAt: json.expiresAt,
      error: json.error,
      code: json.code,
    },
    null,
    2,
  ),
);
if (res.status !== 200 || !json.workUrl) process.exit(1);
