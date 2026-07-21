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
const { data: grants } = await sb.from('manual_hour_grants').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10);
const { data: starter } = await sb.from('user_plan_inventory').select('id,plan_name,plan_type,billing,hours_total,hours_remaining,status,is_active,valid_until,updated_at,source,grant_id,subscription_id').eq('user_id', userId).eq('plan_name', 'starter').eq('status', 'active');
const sumT = (starter||[]).filter(p=>p.plan_type!=='hourly').reduce((s,p)=>s+Number(p.hours_total||0),0);
const sumR = (starter||[]).filter(p=>p.plan_type!=='hourly').reduce((s,p)=>s+Number(p.hours_remaining||0),0);
console.log(JSON.stringify({ grants: (grants||[]).map(g=>({id:g.id,gpu_plan:g.gpu_plan,hours_granted:g.hours_granted,hours_used:g.hours_used,status:g.status,created_at:g.created_at,updated_at:g.updated_at,expires_at:g.expires_at})), starter, sumTotal: sumT, sumRemaining: sumR }, null, 2));