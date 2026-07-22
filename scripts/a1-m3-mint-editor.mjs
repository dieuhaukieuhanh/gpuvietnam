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
console.log(
  JSON.stringify({
    enter: `http://127.0.0.1:5191/enter/${issued.token}`,
    token: issued.token,
  }),
);
