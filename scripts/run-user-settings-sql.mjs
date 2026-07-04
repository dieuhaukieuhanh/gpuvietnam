/**
 * Chạy supabase/user-settings.sql lên Postgres (remote Supabase).
 *
 * Cách 1 — biến môi trường (khuyến nghị):
 *   Thêm vào .env.local:
 *   SUPABASE_DB_URL=postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
 *   Lấy connection string: Supabase Dashboard → Project Settings → Database → Connection string (URI)
 *
 *   npm run db:user-settings
 *
 * Cách 2 — Supabase CLI đã link project:
 *   npx supabase login
 *   npx supabase link --project-ref rhtqiecieeyqjlctcvag
 *   npm run db:user-settings:cli
 */
import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlPath = join(root, 'supabase', 'user-settings.sql');
const envPath = join(root, '.env.local');

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = { ...process.env, ...loadEnvFile(envPath) };
const dbUrl = env.SUPABASE_DB_URL || env.DATABASE_URL;

if (!dbUrl) {
  console.error(`
Thiếu SUPABASE_DB_URL trong .env.local

1. Mở Supabase Dashboard → Project Settings → Database
2. Copy "Connection string" (URI, mode Session hoặc Transaction pooler)
3. Thêm vào .env.local:
   SUPABASE_DB_URL=postgresql://postgres.xxxx:[YOUR-PASSWORD]@...

Hoặc chạy thủ công: mở SQL Editor, dán nội dung file supabase/user-settings.sql → Run
`);
  process.exit(1);
}

console.log('Đang chạy supabase/user-settings.sql ...');

const result = spawnSync(
  'npx',
  ['supabase', 'db', 'query', '--db-url', dbUrl, '-f', sqlPath],
  { stdio: 'inherit', shell: true, cwd: root },
);

process.exit(result.status ?? 1);
