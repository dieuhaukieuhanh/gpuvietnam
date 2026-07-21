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
const { data: grants } = await sb.from('manual_hour_grants').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(5);
const { data: logs } = await sb.from('hour_grant_logs').select('*').order('created_at', { ascending: false }).limit(10);
const { data: inv } = await sb.from('user_plan_inventory').select('*').eq('user_id', userId).eq('status','active').order('updated_at', { ascending: false });
const { data: subs } = await sb.from('subscriptions').select('id,plan,billing,status,hours_total,hours_used,server_status,created_at,updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(8);
const { data: wtx } = await sb.from('wallet_transactions').select('id,type,amount,description,created_at,status').eq('user_id', userId).order('created_at', { ascending: false }).limit(8);
const { data: renews } = await sb.from('plan_renew_requests').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(5);
const starter = (inv||[]).filter(r => String(r.plan_name).toLowerCase()==='starter');
console.log(JSON.stringify({
  grants: (grants||[]).map(g=>({id:g.id,plan:g.gpu_plan,granted:g.hours_granted,used:g.hours_used,status:g.status,updated:g.updated_at})),
  recentLogs: (logs||[]).slice(0,8).map(l=>({id:l.id,grant_id:l.grant_id,action:l.action_type,amount:l.amount,created:l.created_at,reason:l.reason})),
  starterInv: starter.map(r=>({id:r.id,type:r.plan_type,total:r.hours_total,rem:r.hours_remaining,sub:r.subscription_id,grant:r.grant_id,updated:r.updated_at})),
  starterGiftComboTotal: starter.filter(r=>r.plan_type!=='hourly').reduce((s,r)=>s+Number(r.hours_total||0),0),
  starterGiftComboRem: starter.filter(r=>r.plan_type!=='hourly').reduce((s,r)=>s+Number(r.hours_remaining||0),0),
  subs: (subs||[]).map(s=>({id:s.id,plan:s.plan,billing:s.billing,status:s.status,total:s.hours_total,used:s.hours_used,server:s.server_status,updated:s.updated_at,created:s.created_at})),
  walletTx: wtx,
  renews: (renews||[]).map(r=>({id:r.id,plan:r.plan,hours:r.hours_to_add,status:r.status,created:r.created_at,updated:r.updated_at})),
}, null, 2));