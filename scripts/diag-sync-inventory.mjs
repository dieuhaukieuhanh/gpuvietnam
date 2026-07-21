import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
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
const { getSupabaseAdmin } = await import(pathToFileURL(join(process.cwd(), 'src/lib/supabase-admin.js')).href);
const { syncUserPlanInventory } = await import(pathToFileURL(join(process.cwd(), 'src/lib/user-plan-inventory.js')).href);
const userId = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const sb = getSupabaseAdmin();
const before = await sb.from('user_plan_inventory').select('id,plan_name,plan_type,hours_total,hours_remaining,status,subscription_id').eq('user_id', userId).eq('status','active');
const inv = await syncUserPlanInventory(sb, userId);
const after = (inv||[]).filter(r => r.status === 'active' && String(r.plan_name).toLowerCase()==='starter' && r.plan_type !== 'hourly');
const sumT = after.reduce((s,r)=>s+Number(r.hours_total||0),0);
const sumR = after.reduce((s,r)=>s+Number(r.hours_remaining||0),0);
console.log(JSON.stringify({
  beforeActive: (before.data||[]).length,
  afterStarterGiftCombo: after.map(r=>({id:r.id,type:r.plan_type,total:r.hours_total,rem:r.hours_remaining,sub:r.subscription_id,grant:r.grant_id})),
  sumTotal: sumT,
  sumRemaining: sumR,
}, null, 2));