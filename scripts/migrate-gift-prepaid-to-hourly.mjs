import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  const k = t.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = v;
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const userId = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const MOVE_HOURS = 15;

const { data: grant, error: grantErr } = await sb
  .from('manual_hour_grants')
  .select('*')
  .eq('user_id', userId)
  .eq('gpu_plan', 'starter')
  .eq('status', 'active')
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
if (grantErr) throw grantErr;
if (!grant) {
  console.log('No active starter grant');
  process.exit(0);
}

const granted = Number(grant.hours_granted ?? 0);
const used = Number(grant.hours_used ?? 0);
const remaining = Math.max(0, granted - used);
const move = Math.min(MOVE_HOURS, remaining);
if (move <= 0) {
  console.log('Nothing to move', { grant: grant.id, granted, used });
  process.exit(0);
}

const { data: hourlySubs, error: subErr } = await sb
  .from('subscriptions')
  .select('*')
  .eq('user_id', userId)
  .eq('status', 'active')
  .eq('billing', 'hourly');
if (subErr) throw subErr;

const starterHourly = (hourlySubs ?? [])
  .filter((s) => String(s.plan ?? '').toLowerCase().includes('starter'))
  .sort((a, b) => {
    const aOn = a.server_status === 'online' ? 1 : 0;
    const bOn = b.server_status === 'online' ? 1 : 0;
    if (bOn !== aOn) return bOn - aOn;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  })[0];

if (!starterHourly) {
  console.error('No active starter hourly subscription');
  process.exit(1);
}

const nextGrantHours = granted - move;
const nextHourlyTotal = Number(starterHourly.hours_total ?? 0) + move;
const nextHourlyRemaining = Math.max(
  0,
  nextHourlyTotal - Number(starterHourly.hours_used ?? 0),
);
const nextGiftRemaining = Math.max(0, nextGrantHours - used);

console.log('Before', {
  grantId: grant.id,
  granted,
  used,
  hourlyId: starterHourly.id,
  hourlyTotal: starterHourly.hours_total,
  move,
});

const { error: gErr } = await sb
  .from('manual_hour_grants')
  .update({ hours_granted: nextGrantHours, updated_at: new Date().toISOString() })
  .eq('id', grant.id);
if (gErr) throw gErr;

await sb.from('hour_grant_logs').insert({
  grant_id: grant.id,
  admin_id: null,
  action_type: 'adjust',
  amount: -move,
  reason: 'Chuyen mua them gio le tu gift sang Gio le',
});

const { error: hErr } = await sb
  .from('subscriptions')
  .update({ hours_total: nextHourlyTotal })
  .eq('id', starterHourly.id);
if (hErr) throw hErr;

const { error: invHErr } = await sb
  .from('user_plan_inventory')
  .update({
    hours_total: nextHourlyTotal,
    hours_remaining: nextHourlyRemaining,
  })
  .eq('user_id', userId)
  .eq('subscription_id', starterHourly.id)
  .eq('status', 'active');
if (invHErr) throw invHErr;

const { error: invGErr } = await sb
  .from('user_plan_inventory')
  .update({
    hours_total: nextGrantHours,
    hours_remaining: nextGiftRemaining,
  })
  .eq('user_id', userId)
  .eq('grant_id', grant.id)
  .eq('status', 'active');
if (invGErr) throw invGErr;

const { data: inv } = await sb
  .from('user_plan_inventory')
  .select('plan_type,billing,hours_total,hours_remaining,status,subscription_id,grant_id')
  .eq('user_id', userId)
  .eq('status', 'active')
  .eq('plan_name', 'starter');

console.log('After', {
  grantHours: nextGrantHours,
  hourlyTotal: nextHourlyTotal,
  hourlyRemaining: nextHourlyRemaining,
  giftRemaining: nextGiftRemaining,
  inventory: inv,
});
