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
const { data: inv, error } = await sb.from('user_plan_inventory').select('id,plan_name,plan_type,billing,hours_total,hours_remaining,status,subscription_id,grant_id').eq('user_id', userId);
console.log('err', error);
const active = (inv||[]).filter(r => r.status === 'active');
const bySub = {};
for (const r of active) {
  const k = r.grant_id ? 'gift:'+r.grant_id : 'sub:'+(r.subscription_id||'null');
  (bySub[k] ||= []).push({ id: r.id, type: r.plan_type, total: r.hours_total, rem: r.hours_remaining, plan: r.plan_name });
}
const starter = active.filter(r => String(r.plan_name).toLowerCase()==='starter');
const giftCombo = starter.filter(r => r.plan_type !== 'hourly');
const withHourly = starter;
console.log(JSON.stringify({
  bySub,
  starterGiftComboTotal: giftCombo.reduce((s,r)=>s+Number(r.hours_total||0),0),
  starterGiftComboRem: giftCombo.reduce((s,r)=>s+Number(r.hours_remaining||0),0),
  starterAllTotal: withHourly.reduce((s,r)=>s+Number(r.hours_total||0),0),
  starterAllRem: withHourly.reduce((s,r)=>s+Number(r.hours_remaining||0),0),
  hourlyRows: starter.filter(r => r.plan_type==='hourly'),
  newSubAtNapGio: '60737950 = Starter hourly 11h created 13:58',
}, null, 2));