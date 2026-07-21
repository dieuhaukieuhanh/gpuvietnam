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
for (const table of ['machine_operations', 'infrastructure_operations', 'machine_operation_queue']) {
  const { data, error } = await sb.from(table).select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10);
  console.log(table, error?.message || error?.code || 'ok', JSON.stringify(data?.map(r => ({ id: r.id, type: r.type || r.operation_type || r.kind, status: r.status, created_at: r.created_at, machine_id: r.machine_id })) ?? null));
}