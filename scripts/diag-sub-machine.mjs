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
const subRes = await sb.from('subscriptions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(3);
const { data: machine } = await sb.from('machines').select('id,status,subscription_id,billing_started_at,instance_id,gpu_session_id').eq('user_id', userId).eq('status','running').maybeSingle();
const { data: session } = machine?.gpu_session_id
  ? await sb.from('gpu_sessions').select('id,status,started_at,machine_id').eq('id', machine.gpu_session_id).maybeSingle()
  : { data: null };
console.log(JSON.stringify({ machine, session, subErr: subRes.error, subs: (subRes.data||[]).map(s => ({ id:s.id, plan:s.plan, status:s.status, server_status:s.server_status, hours_total:s.hours_total, hours_used:s.hours_used })) }, null, 2));