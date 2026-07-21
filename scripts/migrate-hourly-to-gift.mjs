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

// Convert recent additional Starter hourly purchases (1h + 11h) into gift hours on grant #2
const extraHours = 1 + 11; // 14:08 1h + 13:58 11h
const now = new Date().toISOString();
const { data: grant, error: gErr } = await sb.from('manual_hour_grants').select('*').eq('id', 2).maybeSingle();
if (gErr) throw gErr;
if (!grant) throw new Error('grant 2 missing');
const { data: updated, error: uErr } = await sb.from('manual_hour_grants').update({
  hours_granted: Number(grant.hours_granted) + extraHours,
  updated_at: now,
}).eq('id', 2).select('*').single();
if (uErr) throw uErr;

const logIns = await sb.from('hour_grant_logs').insert({
  grant_id: 2,
  admin_id: grant.admin_id,
  action_type: 'add',
  amount: extraHours,
  reason: 'Migrate mua thêm Starter hourly → giờ gói (gift)',
});
console.log('log', logIns.error);

// Expire orphan hourly inventory rows created by those purchases + mark subs replaced (keep online machine sub)
const hourlySubIds = ['71ee29a0-0ffa-4997-93ca-87285798a899', '60737950-dd9c-44f5-ab41-74358fb082fe'];
await sb.from('user_plan_inventory').update({ status: 'expired', is_active: false }).in('subscription_id', hourlySubIds);
await sb.from('subscriptions').update({ status: 'replaced' }).in('id', hourlySubIds);

// Sync gift inventory row from grant
const rem = Math.max(0, Number(updated.hours_granted) - Number(updated.hours_used || 0));
const { data: giftInv } = await sb.from('user_plan_inventory').select('*').eq('user_id', userId).eq('grant_id', 2).maybeSingle();
if (giftInv) {
  await sb.from('user_plan_inventory').update({
    hours_total: Number(updated.hours_granted),
    hours_remaining: rem,
    status: 'active',
    updated_at: now,
  }).eq('id', giftInv.id);
} else {
  await sb.from('user_plan_inventory').insert({
    user_id: userId,
    plan_type: 'gift',
    plan_name: 'starter',
    hours_total: Number(updated.hours_granted),
    hours_remaining: rem,
    price_per_hour: 0,
    valid_from: now,
    valid_until: updated.expires_at,
    is_active: true,
    status: 'active',
    source: 'granted',
    grant_id: 2,
    billing: null,
    subscription_id: null,
  });
}

const { data: starter } = await sb.from('user_plan_inventory').select('id,plan_type,hours_total,hours_remaining,status,grant_id,subscription_id').eq('user_id', userId).eq('plan_name','starter').eq('status','active');
const giftCombo = (starter||[]).filter(r => r.plan_type !== 'hourly');
console.log(JSON.stringify({
  grantAfter: { id: updated.id, granted: updated.hours_granted, used: updated.hours_used },
  starterActive: starter,
  sumTotal: giftCombo.reduce((s,r)=>s+Number(r.hours_total||0),0),
  sumRem: giftCombo.reduce((s,r)=>s+Number(r.hours_remaining||0),0),
}, null, 2));