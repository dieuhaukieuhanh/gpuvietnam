import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
function loadEnv() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[t.slice(0, i).trim()] == null) process.env[t.slice(0, i).trim()] = v;
  }
}
loadEnv();
const uid = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: subs } = await sb
  .from('subscriptions')
  .select('id,plan,server_status,machine_id,updated_at')
  .eq('user_id', uid)
  .order('updated_at', { ascending: false })
  .limit(5);
const opsTry = await sb
  .from('machine_operations')
  .select('id,operation_type,status,machine_id,error_message,created_at')
  .eq('user_id', uid)
  .order('created_at', { ascending: false })
  .limit(8);
const ops = opsTry.error
  ? (await sb.from('pending_operations').select('*').order('created_at', { ascending: false }).limit(5)).data
  : opsTry.data;
const { data: inv } = await sb
  .from('user_plan_inventory')
  .select('id,plan_name,hours_remaining,is_active,subscription_id')
  .eq('id', 21)
  .maybeSingle();
const cloreKey = (process.env.CLORE_API_KEY || process.env.CLORE_AI_KEY || '').trim();
const ordersRes = await fetch('https://api.clore.ai/v1/my_orders', {
  headers: { Accept: 'application/json', auth: cloreKey },
});
const orders = await ordersRes.json().catch(() => ({}));
const list = Array.isArray(orders?.orders)
  ? orders.orders.slice(0, 8).map((o) => ({
      id: o.id,
      image: o.image || o.docker_image,
      http: o.http_pub || o.http,
      status: o.status,
    }))
  : { status: ordersRes.status, body: orders };
console.log(JSON.stringify({ inv21: inv, subs, opsError: opsTry.error?.message, ops, clore: list }, null, 2));
