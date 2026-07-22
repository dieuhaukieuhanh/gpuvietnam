/**
 * Mint editor token + wrangler KV put; print enter URL for production browser smoke.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { issueComfyAccessToken } from '../src/lib/comfy-proxy/comfy-access-token.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
process.env.COMFY_PROXY_BASE_URL =
  process.env.COMFY_PROXY_BASE_URL || 'https://work.gpuvietnam.com';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const issued = await issueComfyAccessToken(sb, {
  userId: '70feafcf-6ad1-4b13-bb99-eae5a538d20a',
  mode: 'editor',
});
const hash = createHash('sha256').update(issued.token, 'utf8').digest('hex');
const exp = Math.floor(new Date(issued.expiresAt).getTime() / 1000);
const ttl = Math.max(120, exp - Math.floor(Date.now() / 1000));
const key = `comfy:${hash}`;
const tmp = join(tmpdir(), `a1-m3-browser-kv-${Date.now()}.json`);
writeFileSync(
  tmp,
  JSON.stringify({
    upstream: null,
    userId: '70feafcf-6ad1-4b13-bb99-eae5a538d20a',
    machineId: null,
    exp,
    mode: 'editor',
  }),
);
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
    process.env.CF_KV_NAMESPACE_ID,
    '--ttl',
    String(ttl),
  ],
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
  console.error(put.stderr || put.stdout);
  process.exit(1);
}
console.log(JSON.stringify({ enter: issued.workUrl, token: issued.token }));
