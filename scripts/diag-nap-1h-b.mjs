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
const userId = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const { data: inv } = await sb.from('user_plan_inventory').select('id,plan_name,plan_type,hours_total,hours_remaining,status,subscription_id,updated_at,created_at').eq('user_id', userId).order('id');
const { data: subs } = await sb.from('subscriptions').select('id,plan,billing,status,hours_total,hours_used,created_at,updated_at').eq('user_id', userId).ilike('plan','%starter%').order('created_at',{ascending:false});
console.log(JSON.stringify({ inv: (inv||[]).filter(r=>String(r.plan_name).toLowerCase().includes('starter')||r.status==='active'), subs }, null, 2));