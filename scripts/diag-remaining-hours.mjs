import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  calculateTotalEntitlement,
  filterEntitlementPlansForMachine,
  resolveMachinePlanKey,
} from '../src/lib/gpu/remaining-time.js';

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });
const userId = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';

const { data: plans, error: plansErr } = await sb
  .from('user_plan_inventory')
  .select('id,plan_name,plan_type,billing,hours_total,hours_remaining,price_per_hour,status,is_active,valid_until')
  .eq('user_id', userId)
  .eq('status', 'active');

const { data: user } = await sb.from('users').select('wallet_balance').eq('id', userId).maybeSingle();
const { data: machine } = await sb
  .from('machines')
  .select('id,status,gpu_line,gpu_type,billing_inventory_id,billing_started_at,plan,gpu_label')
  .eq('user_id', userId)
  .eq('status', 'running')
  .maybeSingle();

const entitlementPlans = (plans ?? []).map((p) => ({
  ...p,
  hours_remaining: Number(p.hours_remaining ?? 0),
  price_per_hour: Number(p.price_per_hour ?? 0),
}));

const planKey = resolveMachinePlanKey(machine, entitlementPlans);
const scoped = filterEntitlementPlansForMachine(entitlementPlans, machine);
const wallet = Number(user?.wallet_balance ?? 0);

let giftCombo = 0;
let hourly = null;
for (const plan of scoped) {
  if (plan.plan_type === 'hourly') { hourly = plan; continue; }
  giftCombo += Number(plan.hours_remaining ?? 0);
}
const walletHours = hourly && Number(hourly.price_per_hour) > 0 ? wallet / Number(hourly.price_per_hour) : 0;
const total = calculateTotalEntitlement({ entitlementPlans, walletBalance: wallet, machine });

const report = {
  wallet, machine, planKey, plansErr: plansErr?.message ?? null, plans,
  scoped: scoped.map((p) => ({
    id: p.id, plan_name: p.plan_name, plan_type: p.plan_type,
    hours_total: p.hours_total, hours_remaining: p.hours_remaining, price_per_hour: p.price_per_hour,
  })),
  giftCombo, walletHours, totalEntitlement: total,
  sumAllRemaining: entitlementPlans.filter((p) => p.plan_type !== 'hourly').reduce((s, p) => s + Number(p.hours_remaining ?? 0), 0),
  sumScopedTotal: scoped.filter((p) => p.plan_type !== 'hourly').reduce((s, p) => s + Number(p.hours_total ?? 0), 0),
};
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/diag-remaining-hours.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));