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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[t.slice(0, i).trim()] == null) process.env[t.slice(0, i).trim()] = v;
  }
}
loadEnv();
const uid = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data } = await sb
  .from('machines')
  .select('id,status,image,instance_id,ip_address,port,provider,created_at,updated_at,projection_message')
  .eq('user_id', uid)
  .order('created_at', { ascending: false })
  .limit(8);
console.log(JSON.stringify(data, null, 2));
