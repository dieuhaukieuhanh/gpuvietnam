import { readFileSync } from 'node:fs';
import pg from 'pg';

let url = '';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  if (!line.startsWith('SUPABASE_DB_URL=')) continue;
  url = line.slice('SUPABASE_DB_URL='.length).trim();
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1);
  }
}
if (!url) throw new Error('missing SUPABASE_DB_URL');

// Encode password segment if URL() fails (special chars in password).
let connectionString = url;
try {
  // eslint-disable-next-line no-new
  new URL(url);
} catch {
  const protoIdx = url.indexOf('://');
  const atIdx = url.lastIndexOf('@');
  if (protoIdx > 0 && atIdx > protoIdx) {
    const auth = url.slice(protoIdx + 3, atIdx);
    const hostPart = url.slice(atIdx + 1);
    const colon = auth.indexOf(':');
    const user = colon >= 0 ? auth.slice(0, colon) : auth;
    const pass = colon >= 0 ? auth.slice(colon + 1) : '';
    connectionString =
      url.slice(0, protoIdx + 3) +
      encodeURIComponent(user) +
      ':' +
      encodeURIComponent(pass) +
      '@' +
      hostPart;
  }
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(readFileSync('supabase/machines-ssh-password.sql', 'utf8'));
const { rowCount } = await client.query(
  "select 1 from information_schema.columns where table_schema='public' and table_name='machines' and column_name='ssh_password'",
);
console.log('ssh_password present', rowCount > 0);
await client.end();