/**
 * Sprint 1 verification — measure real GET /api/dashboard/me profiler output.
 * Usage: node scripts/profile-read-path-sprint1.mjs [--runs=5] [--base-url=http://localhost:3000]
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_* and SUPABASE_SERVICE_ROLE_KEY.
 * Optional: BENCH_DASHBOARD_EMAIL + BENCH_DASHBOARD_PASSWORD for signInWithPassword.
 */

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadEnvLocal() {
  const envPath = path.join(root, '.env.local');
  if (!existsSync(envPath)) {
    throw new Error('Missing .env.local — cannot authenticate dashboard/me bench.');
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function parseArgs(argv) {
  const out = { runs: 5, baseUrl: 'http://localhost:3000', logFile: '' };
  for (const arg of argv) {
    if (arg.startsWith('--runs=')) out.runs = Number(arg.slice(7));
    else if (arg.startsWith('--base-url=')) out.baseUrl = arg.slice(11).replace(/\/$/, '');
    else if (arg.startsWith('--log-file=')) out.logFile = arg.slice(11);
  }
  return out;
}

async function resolveAccessToken(supabaseUrl, anonKey, serviceRoleKey) {
  const benchEmail = process.env.BENCH_DASHBOARD_EMAIL;
  const benchPassword = process.env.BENCH_DASHBOARD_PASSWORD;
  const pub = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (benchEmail && benchPassword) {
    const { data, error } = await pub.auth.signInWithPassword({
      email: benchEmail,
      password: benchPassword,
    });
    if (error || !data.session?.access_token) {
      throw new Error(`BENCH signInWithPassword failed: ${error?.message ?? 'no session'}`);
    }
    return data.session.access_token;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: subs, error: subErr } = await admin
    .from('subscriptions')
    .select('user_id')
    .in('status', ['active', 'provisioning'])
    .limit(1);
  if (subErr) throw subErr;
  const userId = subs?.[0]?.user_id;
  if (!userId) throw new Error('No active/provisioning subscription user for bench.');

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(String(userId));
  if (userErr) throw userErr;
  const email = userData.user?.email;
  if (!email) throw new Error(`No email for subscription user ${userId}.`);

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr) throw linkErr;

  const tokenHash = linkData?.properties?.hashed_token;
  if (!tokenHash) throw new Error('generateLink did not return hashed_token.');

  const { data: otpData, error: otpErr } = await pub.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  if (otpErr || !otpData.session?.access_token) {
    throw new Error(`verifyOtp failed: ${otpErr?.message ?? 'no session'}`);
  }
  return otpData.session.access_token;
}

/** @param {string} block */
function parseProfBlock(block) {
  /** @type {Record<string, number>} */
  const metrics = {};
  const totalMatch = block.match(/Dashboard request \((\d+)ms total\)/);
  if (totalMatch) metrics.dashboardTotal = Number(totalMatch[1]);

  for (const line of block.split('\n')) {
    const m = line.match(/(.+?)\s+(\d+)ms\s*$/);
    if (!m) continue;
    let label = m[1]
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/^\s+/, '')
      .trim();
    if (!label || label.includes('Dashboard request')) continue;
    if (label.includes('runReadPathProjectionFirst')) {
      label = 'runReadPathProjectionFirst (call)';
    }
    metrics[label] = Number(m[2]);
  }
  return metrics;
}

function stats(values) {
  if (!values.length) return { min: null, max: null, avg: null };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return { min, max, avg };
}

function readNewProfBlocks(logFile, fromByte) {
  if (!logFile || !existsSync(logFile)) return { blocks: [], nextOffset: fromByte };
  const buf = readFileSync(logFile);
  const content = (
    buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8')
  ).replace(/\r\n/g, '\n');
  const slice = content.slice(fromByte);
  const blocks = [];
  const parts = slice.split('[prof]\n');
  for (let i = 1; i < parts.length; i += 1) {
    blocks.push(parts[i].split('\n\n')[0].trim());
  }
  return { blocks, nextOffset: fromByte + slice.length };
}

loadEnvLocal();
const { runs, baseUrl, logFile } = parseArgs(process.argv.slice(2));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.');
}

const token = await resolveAccessToken(supabaseUrl, anonKey, serviceRoleKey);
console.info(`Bench: ${runs} GET ${baseUrl}/api/dashboard/me`);

let logOffset = 0;
if (logFile && existsSync(logFile)) {
  const buf = readFileSync(logFile);
  const content = (
    buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8')
  ).replace(/\r\n/g, '\n');
  logOffset = content.length;
}
/** @type {Record<string, number>[]} */
const samples = [];

for (let i = 0; i < runs; i += 1) {
  const started = Date.now();
  const res = await fetch(`${baseUrl}/api/dashboard/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const wallMs = Date.now() - started;
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Run ${i + 1} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  let parsed = null;
  if (logFile) {
    await new Promise((r) => setTimeout(r, 800));
    const { blocks, nextOffset } = readNewProfBlocks(logFile, logOffset);
    logOffset = nextOffset;
    if (blocks.length > 0) parsed = parseProfBlock(blocks[blocks.length - 1]);
  }

  const row = parsed ?? { dashboardTotal: wallMs };
  row.httpWallMs = wallMs;
  samples.push(row);
  console.info(`Run ${i + 1}: HTTP ${wallMs}ms` + (parsed?.dashboardTotal ? ` prof-total ${parsed.dashboardTotal}ms` : ''));
  await new Promise((r) => setTimeout(r, 400));
}

const keys = [
  'dashboardTotal',
  'runReadPathProjectionFirst (call)',
  'Load Machine',
  'Load Subscription',
  'Detect Projection',
  'Drift Queue Enqueue',
  'Projection Verify Queue Enqueue',
  'readRemainingForUser',
  'readRemainingForMachine',
  'syncUserPlanInventory',
  'syncUserPlanInventory (idle)',
  'httpWallMs',
];

console.info('\n=== Sprint 1 Verification (measured) ===\n');
console.info('| Metric | Min | Max | Avg |');
console.info('|--------|-----|-----|-----|');
for (const key of keys) {
  const values = samples.map((s) => s[key]).filter((v) => typeof v === 'number');
  if (!values.length) continue;
  const { min, max, avg } = stats(values);
  console.info(`| ${key} | ${min} | ${max} | ${avg} |`);
}

const outPath = path.join(root, 'scripts', 'profile-read-path-sprint1-results.json');
appendFileSync(
  outPath,
  `${new Date().toISOString()}\n${JSON.stringify({ samples }, null, 2)}\n\n`,
);
console.info(`\nWrote ${outPath}`);

if (!logFile) {
  console.warn(
    '\nNote: pass --log-file=<dev-server-log> to parse [prof] spans from server stdout.',
  );
}
