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
const { data: inv } = await sb.from('user_plan_inventory').select('*').eq('user_id', userId).eq('status','active');
const keep = new Map();
const expireIds = [];
for (const row of inv || []) {
  const key = row.grant_id ? 'gift:'+row.grant_id : 'sub:'+(row.subscription_id || 'main');
  if (keep.has(key)) expireIds.push(row.id);
  else keep.set(key, row.id);
}
if (expireIds.length) {
  const { error } = await sb.from('user_plan_inventory').update({ status: 'expired', is_active: false }).in('id', expireIds);
  console.log('expired', expireIds, error);
}
const { data: after } = await sb.from('user_plan_inventory').select('id,plan_name,plan_type,hours_total,hours_remaining,status,subscription_id,grant_id').eq('user_id', userId).eq('status','active');
const starter = (after||[]).filter(r => String(r.plan_name).toLowerCase()==='starter' && r.plan_type !== 'hourly');
console.log(JSON.stringify({
  expiredIds: expireIds,
  starterGiftCombo: starter,
  sumTotal: starter.reduce((s,r)=>s+Number(r.hours_total||0),0),
  sumRem: starter.reduce((s,r)=>s+Number(r.hours_remaining||0),0),
}, null, 2));