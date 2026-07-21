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
const { data: inv, error } = await sb.from('user_plan_inventory').select('*').eq('user_id', userId).order('id');
const { data: subs } = await sb.from('subscriptions').select('id,plan,billing,status,server_status,hours_total,hours_used,created_at,updated_at,expires_at').eq('user_id', userId).in('status',['active','provisioning']).order('created_at',{ascending:false});
const starter = (inv||[]).filter(r => String(r.plan_name).toLowerCase().includes('starter') && r.status==='active');
const giftCombo = starter.filter(r => r.plan_type !== 'hourly');
console.log(JSON.stringify({
  err: error?.message,
  invCount: inv?.length,
  starterRows: starter.map(r => ({id:r.id,type:r.plan_type,billing:r.billing,total:r.hours_total,rem:r.hours_remaining,status:r.status,active:r.is_active,sub:r.subscription_id,grant:r.grant_id,updated:r.updated_at})),
  starterSumTotal: giftCombo.reduce((s,r)=>s+Number(r.hours_total||0),0),
  starterSumRem: giftCombo.reduce((s,r)=>s+Number(r.hours_remaining||0),0),
  subs,
}, null, 2));