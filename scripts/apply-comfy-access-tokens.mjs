import fs from 'fs';
import pg from 'pg';

const lines = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/);
const line = lines.find((l) => l.startsWith('SUPABASE_DB_URL=') || l.startsWith('DATABASE_URL='));
let raw = line.slice(line.indexOf('=') + 1).trim();
if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
  raw = raw.slice(1, -1);
}
const withoutProto = raw.replace(/^postgres(ql)?:\/\//, '');
const at = withoutProto.lastIndexOf('@');
const userinfo = withoutProto.slice(0, at);
const colon = userinfo.indexOf(':');
const poolUser = decodeURIComponent(userinfo.slice(0, colon));
const password = decodeURIComponent(userinfo.slice(colon + 1));
const ref = poolUser.includes('.') ? poolUser.split('.')[1] : null;

const candidates = [
  { host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres', password },
  { host: 'aws-0-ap-southeast-1.pooler.supabase.com', port: 6543, user: poolUser, password },
  { host: 'aws-0-ap-southeast-1.pooler.supabase.com', port: 5432, user: poolUser, password },
];

const sql = fs.readFileSync('supabase/comfy-access-tokens.sql', 'utf8');

for (const cfg of candidates) {
  console.log('try', cfg.host, cfg.port, cfg.user);
  const client = new pg.Client({ ...cfg, database: 'postgres', ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(sql);
    const r = await client.query("select to_regclass('public.comfy_access_tokens') as t");
    console.log('SQL_OK', r.rows[0].t);
    await client.end();
    process.exit(0);
  } catch (e) {
    console.log('fail', e.message);
    try { await client.end(); } catch {}
  }
}
process.exit(1);