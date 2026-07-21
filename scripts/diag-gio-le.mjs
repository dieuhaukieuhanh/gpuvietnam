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
const { data: wtx } = await sb.from('wallet_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(5);
const { data: inv } = await sb.from('user_plan_inventory').select('*').eq('user_id', userId).eq('plan_name','starter').order('updated_at',{ascending:false});
const { data: grants } = await sb.from('manual_hour_grants').select('*').eq('user_id', userId).eq('gpu_plan','starter');
const { data: subs } = await sb.from('subscriptions').select('id,plan,billing,status,hours_total,hours_used,created_at,updated_at').eq('user_id', userId).ilike('plan','%Starter%').order('created_at',{ascending:false}).limit(8);
console.log(JSON.stringify({
  recentTx: (wtx||[]).map(t=>({amount:t.amount,desc:t.description,at:t.created_at})),
  grants: (grants||[]).map(g=>({id:g.id,granted:g.hours_granted,used:g.hours_used,status:g.status,updated:g.updated_at})),
  starterInv: (inv||[]).map(r=>({id:r.id,type:r.plan_type,billing:r.billing,total:r.hours_total,rem:r.hours_remaining,status:r.status,sub:r.subscription_id,grant:r.grant_id,updated:r.updated_at})),
  starterSubs: subs,
}, null, 2));