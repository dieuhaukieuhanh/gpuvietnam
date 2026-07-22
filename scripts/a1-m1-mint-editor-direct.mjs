/**
 * Mint editor token via lib (no Next required) + optional HTTP smoke on work.*.
 * Usage: node scripts/a1-m1-mint-editor-direct.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { issueComfyAccessToken } from '../src/lib/comfy-proxy/comfy-access-token.js';

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

process.env.COMFY_PROXY_ENABLED = process.env.COMFY_PROXY_ENABLED || '1';
if (!process.env.COMFY_PROXY_BASE_URL) {
  process.env.COMFY_PROXY_BASE_URL = 'https://work.gpuvietnam.com';
}

const USER_ID = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const sbAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const issued = await issueComfyAccessToken(sbAdmin, {
  userId: USER_ID,
  mode: 'editor',
  upstreamUrl: null,
  machineId: null,
});

const enterUrl = issued.workUrl;
console.log(
  JSON.stringify(
    {
      mode: issued.mode,
      expiresAt: issued.expiresAt,
      enterUrl,
      tokenPrefix: String(issued.token).slice(0, 8) + '…',
    },
    null,
    2,
  ),
);

// Smoke: enter → follow redirect → expect Comfy shell HTML (not 401)
const enter = await fetch(enterUrl, {
  redirect: 'manual',
  signal: AbortSignal.timeout(30000),
});
const loc = enter.headers.get('location') || '';
const setCookie = enter.headers.get('set-cookie') || '';
console.log(
  JSON.stringify(
    {
      enterStatus: enter.status,
      location: loc,
      hasCookie: /gvn_comfy=/i.test(setCookie),
    },
    null,
    2,
  ),
);

if (enter.status !== 302 || !/gvn_comfy=/i.test(setCookie)) {
  console.error('FAIL enter did not set cookie / redirect');
  process.exit(1);
}

const cookieMatch = setCookie.match(/gvn_comfy=([^;]+)/i);
const cookieHeader = cookieMatch ? `gvn_comfy=${cookieMatch[1]}` : '';
const shell = await fetch('https://work.gpuvietnam.com/', {
  headers: { Cookie: cookieHeader },
  signal: AbortSignal.timeout(30000),
});
const html = await shell.text();
const settings = await fetch('https://work.gpuvietnam.com/api/settings', {
  headers: { Cookie: cookieHeader },
  signal: AbortSignal.timeout(15000),
});
const settingsJson = await settings.json().catch(() => ({}));
const ext = await fetch('https://work.gpuvietnam.com/api/extensions', {
  headers: { Cookie: cookieHeader },
  signal: AbortSignal.timeout(15000),
});
const extJson = await ext.json().catch(() => null);
const prompt = await fetch('https://work.gpuvietnam.com/api/prompt', {
  method: 'POST',
  headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: {}, client_id: 'm1-prod' }),
  signal: AbortSignal.timeout(15000),
});
const promptJson = await prompt.json().catch(() => ({}));

const report = {
  shellStatus: shell.status,
  shellIsComfy: /ComfyUI/i.test(html),
  shellHasAssets: /assets\//i.test(html),
  settingsOk: settings.ok && Boolean(settingsJson['Comfy.InstalledVersion']),
  extensionsEmpty: ext.ok && Array.isArray(extJson) && extJson.length === 0,
  promptBlocked: prompt.status === 503 && promptJson.code === 'A1_RUNTIME_OFFLINE',
  htmlBytes: html.length,
};
const pass =
  report.shellStatus === 200 &&
  report.shellIsComfy &&
  report.shellHasAssets &&
  report.settingsOk &&
  report.extensionsEmpty &&
  report.promptBlocked;

console.log(JSON.stringify({ milestone: 'A1-M1-production', verdict: pass ? 'PASS' : 'FAIL', report }, null, 2));
process.exit(pass ? 0 : 1);
