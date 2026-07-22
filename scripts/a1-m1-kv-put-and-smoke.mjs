/**
 * Mint editor token, put CF KV via wrangler (OAuth), smoke work.*.
 * Clears CF_API_TOKEN for wrangler so OAuth login is used (REST token was 401).
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
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
process.env.COMFY_PROXY_ENABLED = '1';
process.env.COMFY_PROXY_BASE_URL =
  process.env.COMFY_PROXY_BASE_URL || 'https://work.gpuvietnam.com';

const USER_ID = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const ns = process.env.CF_KV_NAMESPACE_ID;
if (!ns) {
  console.error('CF_KV_NAMESPACE_ID missing');
  process.exit(1);
}

const sbAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const issued = await issueComfyAccessToken(sbAdmin, {
  userId: USER_ID,
  mode: 'editor',
});
const hash = createHash('sha256').update(issued.token, 'utf8').digest('hex');
const exp = Math.floor(new Date(issued.expiresAt).getTime() / 1000);
const ttl = Math.max(120, exp - Math.floor(Date.now() / 1000));
const key = `comfy:${hash}`;
const payload = JSON.stringify({
  upstream: null,
  userId: USER_ID,
  machineId: null,
  exp,
  mode: 'editor',
});

// Avoid repo path with spaces ("GPU + AI") — wrangler argv splits on spaces.
const tmp = join(tmpdir(), `a1-m1-kv-${Date.now()}.json`);
writeFileSync(tmp, payload);

console.log(JSON.stringify({ enterUrl: issued.workUrl, kvKey: key, ttl, tmp }, null, 2));

const env = { ...process.env };
delete env.CF_API_TOKEN;
delete env.CLOUDFLARE_API_TOKEN;

const put = spawnSync(
  'npx',
  [
    'wrangler',
    'kv',
    'key',
    'put',
    key,
    '--path',
    tmp,
    '--namespace-id',
    ns,
    '--ttl',
    String(ttl),
  ],
  {
    cwd: join(process.cwd(), 'workers/comfy-proxy'),
    encoding: 'utf8',
    shell: true,
    env,
    windowsVerbatimArguments: false,
  },
);

console.log('kv_put_status', put.status);
console.log(((put.stdout || '') + (put.stderr || '')).slice(-1000));
try {
  unlinkSync(tmp);
} catch {
  /* ignore */
}
if (put.status !== 0) {
  console.error('FAIL kv put');
  process.exit(1);
}

const enter = await fetch(issued.workUrl, {
  redirect: 'manual',
  signal: AbortSignal.timeout(30000),
});
const setCookie = enter.headers.get('set-cookie') || '';
console.log(
  JSON.stringify(
    {
      enterStatus: enter.status,
      location: enter.headers.get('location'),
      hasCookie: /gvn_comfy=/i.test(setCookie),
    },
    null,
    2,
  ),
);
if (enter.status !== 302 || !/gvn_comfy=/i.test(setCookie)) {
  console.error('FAIL enter');
  process.exit(1);
}

const cookieMatch = setCookie.match(/gvn_comfy=([^;]+)/i);
const cookieHeader = `gvn_comfy=${cookieMatch[1]}`;
const shell = await fetch('https://work.gpuvietnam.com/', {
  headers: { Cookie: cookieHeader },
  signal: AbortSignal.timeout(30000),
});
const html = await shell.text();
const settings = await fetch('https://work.gpuvietnam.com/api/settings', {
  headers: { Cookie: cookieHeader },
});
const settingsJson = await settings.json().catch(() => ({}));
const ext = await fetch('https://work.gpuvietnam.com/api/extensions', {
  headers: { Cookie: cookieHeader },
});
const extJson = await ext.json().catch(() => null);
const prompt = await fetch('https://work.gpuvietnam.com/api/prompt', {
  method: 'POST',
  headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: {}, client_id: 'm1-prod' }),
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

console.log(
  JSON.stringify(
    {
      milestone: 'A1-M1-production',
      verdict: pass ? 'PASS' : 'FAIL',
      report,
      enterUrl: issued.workUrl,
    },
    null,
    2,
  ),
);
process.exit(pass ? 0 : 1);
