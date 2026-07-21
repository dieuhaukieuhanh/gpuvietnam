import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  const k = t.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = v;
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.from('manual_hour_grants').insert({
  admin_id: null,
  user_id: '70feafcf-6ad1-4b13-bb99-eae5a538d20a',
  hours_granted: 1,
  hours_used: 0,
  gpu_plan: 'starter',
  status: 'active',
  customer_note: 'null-admin-grant-test',
}).select('id').single();
console.log(error || data);
if (data?.id) {
  await sb.from('manual_hour_grants').delete().eq('id', data.id);
}