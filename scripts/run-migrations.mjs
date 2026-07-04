/**
 * GPUVietnam — SQL Migration Runner (RC1)
 *
 * Production-safe, deterministic migration executor driven by
 * supabase/MIGRATION_MANIFEST.json. Records every applied migration
 * in public.schema_migrations so a fresh database and an existing
 * database converge to the same final schema.
 *
 * Modes:
 *   node scripts/run-migrations.mjs                Apply all pending migrations in canonical order.
 *   node scripts/run-migrations.mjs --dry-run      Print the plan, execute nothing.
 *   node scripts/run-migrations.mjs --list         Print manifest + applied status (read-only).
 *   node scripts/run-migrations.mjs --only <id>    Apply a single migration (and its prerequisites).
 *   node scripts/run-migrations.mjs --baseline <id>  Mark all migrations up to and including <id>
 *                                                   as applied WITHOUT executing (for existing DBs).
 *   node scripts/run-migrations.mjs --include-seeds  Also apply seed entries after their deps.
 *   node scripts/run-migrations.mjs --verify        Run supabase/verify-sc-schema.sql (read-only checklist).
 *
 * Env (read from .env.local or the process environment):
 *   SUPABASE_DB_URL   postgresql://...   (required)
 *
 * Execution uses the Supabase CLI (`npx supabase db query --db-url … -f …`),
 * matching the established scripts/run-user-settings-sql.mjs pattern. No
 * business logic, settlement behaviour, lifecycle behaviour, or transaction
 * semantics are changed — this is pure deployment plumbing.
 */
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'supabase', 'MIGRATION_MANIFEST.json');
const envPath = join(root, '.env.local');
const tmpDir = tmpdir();

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

function getDbUrl() {
  const env = { ...process.env, ...loadEnvFile(envPath) };
  const url = env.SUPABASE_DB_URL || env.DATABASE_URL;
  if (!url) {
    console.error(`
Thieu SUPABASE_DB_URL trong .env.local

1. Supabase Dashboard → Project Settings → Database → Connection string (URI)
2. Them vao .env.local:
   SUPABASE_DB_URL=postgresql://postgres.xxxx:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
`);
    process.exit(1);
  }
  return url;
}

/**
 * Execute a SQL file via the Supabase CLI. Returns the exit status.
 * stdio is inherited so the operator sees migration output / errors.
 */
function execSqlFile(dbUrl, filePath) {
  const result = spawnSync(
    'npx',
    ['supabase', 'db', 'query', '--db-url', dbUrl, '-f', filePath],
    { stdio: 'inherit', shell: true, cwd: root },
  );
  return result.status ?? 1;
}

/**
 * Execute a SQL string via a temp file. Returns { status, stdout }.
 * Used for catalog reads (COPY ... TO STDOUT) and migration recording.
 */
function execSqlInline(dbUrl, sql) {
  const tmp = join(tmpDir, `gpuvn_mig_${process.pid}_${Date.now()}.sql`);
  writeFileSync(tmp, sql);
  try {
    const result = spawnSync(
      'npx',
      ['supabase', 'db', 'query', '--db-url', dbUrl, '-f', tmp],
      { stdio: ['ignore', 'pipe', 'pipe'], shell: true, cwd: root, encoding: 'utf8' },
    );
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/** Read the set of already-applied migration ids from schema_migrations. */
function getApplied(dbUrl) {
  const { status, stdout } = execSqlInline(
    dbUrl,
    `COPY (SELECT id FROM public.schema_migrations ORDER BY id) TO STDOUT;`,
  );
  if (status !== 0) {
    // schema_migrations not present yet → bootstrap will create it.
    return { ok: false, applied: new Set() };
  }
  const applied = new Set(
    stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z0-9_-]+$/.test(s)),
  );
  return { ok: true, applied };
}

/** Record a migration id as applied (idempotent). */
function recordMigration(dbUrl, entry) {
  const sql = `INSERT INTO public.schema_migrations (id, file, category)
    VALUES ('${entry.id}', '${entry.file.replace(/'/g, "''")}', '${entry.category}')
    ON CONFLICT (id) DO NOTHING;`;
  const { status, stderr } = execSqlInline(dbUrl, sql);
  if (status !== 0) {
    console.error(`[migrate] FAILED to record ${entry.id}: ${stderr}`);
    process.exit(1);
  }
}

/** Resolve a manifest file path to an absolute repo-root path. */
function resolvePath(file) {
  return join(root, file);
}

function applyEntry(dbUrl, entry) {
  const abs = resolvePath(entry.file);
  if (!existsSync(abs)) {
    console.error(`[migrate] MISSING migration file for ${entry.id}: ${entry.file}`);
    process.exit(1);
  }
  console.log(`[migrate] applying ${entry.id}  ${entry.file}`);
  const status = execSqlFile(dbUrl, abs);
  if (status !== 0) {
    console.error(`[migrate] FAILED at ${entry.id} (${entry.file}). Aborting. ` +
      `Database unchanged beyond this point; fix and re-run (already-applied migrations are skipped).`);
    process.exit(1);
  }
  recordMigration(dbUrl, entry);
  console.log(`[migrate] recorded ${entry.id}`);
}

function main() {
  const args = process.argv.slice(2);
  const flags = {
    dryRun: args.includes('--dry-run'),
    list: args.includes('--list'),
    verify: args.includes('--verify'),
    includeSeeds: args.includes('--include-seeds'),
    only: null,
    baseline: null,
  };
  const onlyIdx = args.indexOf('--only');
  if (onlyIdx !== -1 && args[onlyIdx + 1]) flags.only = args[onlyIdx + 1];
  const baseIdx = args.indexOf('--baseline');
  if (baseIdx !== -1 && args[baseIdx + 1]) flags.baseline = args[baseIdx + 1];

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const order = manifest.applied_order;
  const seeds = manifest.seeds || [];

  const dbUrl = getDbUrl();

  // --- VERIFY mode: run the read-only checklist ---
  if (flags.verify) {
    const verifyFile = resolvePath('supabase/verify-sc-schema.sql');
    const status = execSqlFile(dbUrl, verifyFile);
    process.exit(status);
  }

  // --- LIST mode: read-only manifest + applied status ---
  if (flags.list) {
    const { applied } = getApplied(dbUrl);
    console.log('\n%-6s %-10s %-44s %s', 'ID', 'CATEGORY', 'FILE', 'STATUS');
    console.log('-'.repeat(90));
    for (const e of order) {
      const status = applied.has(e.id) ? 'applied' : 'pending';
      console.log('%-6s %-10s %-44s %s', e.id, e.category, e.file, status);
    }
    if (flags.includeSeeds) {
      for (const e of seeds) {
        const status = applied.has(e.id) ? 'applied' : 'pending';
        console.log('%-6s %-10s %-44s %s', e.id, 'seed', e.file, status);
      }
    }
    console.log('\n(historical: %d files — never applied by the runner)',
      (manifest.historical || []).length);
    return;
  }

  // --- BASELINE mode: mark-as-applied without executing (existing DBs) ---
  if (flags.baseline) {
    const upTo = order.findIndex((e) => e.id === flags.baseline);
    if (upTo === -1) {
      console.error(`[migrate] baseline id "${flags.baseline}" not found in manifest`);
      process.exit(1);
    }
    // Ensure the tracking table exists first.
    const bootstrap = order.find((e) => e.id === '0000');
    console.log(`[migrate] baseline: ensuring tracking table (${bootstrap.file})`);
    execSqlFile(dbUrl, resolvePath(bootstrap.file));
    recordMigration(dbUrl, bootstrap);
    for (let i = 0; i <= upTo; i++) {
      const e = order[i];
      if (e.id === '0000') continue;
      console.log(`[migrate] baseline: marking ${e.id} as applied (no execute)`);
      recordMigration(dbUrl, e);
    }
    console.log(`[migrate] baseline set at ${flags.baseline}. Run "npm run db:migrate" to apply any newer migrations.`);
    return;
  }

  // --- RUN mode (default) / --only / --dry-run / --include-seeds ---
  // 1. Ensure bootstrap tracking table.
  const bootstrap = order.find((e) => e.id === '0000');
  const { applied: appliedBeforeBoot } = getApplied(dbUrl);
  if (!appliedBeforeBoot.has(bootstrap.id)) {
    if (flags.dryRun) {
      console.log(`[dry-run] would apply ${bootstrap.id}  ${bootstrap.file}`);
    } else {
      console.log(`[migrate] applying ${bootstrap.id}  ${bootstrap.file}`);
      const st = execSqlFile(dbUrl, resolvePath(bootstrap.file));
      if (st !== 0) { console.error('[migrate] FAILED at bootstrap'); process.exit(1); }
      recordMigration(dbUrl, bootstrap);
    }
  }

  const { applied } = flags.dryRun
    ? { applied: appliedBeforeBoot }
    : getApplied(dbUrl);

  // Build the execution list.
  let execList;
  if (flags.only) {
    const target = order.find((e) => e.id === flags.only);
    if (!target) { console.error(`[migrate] --only id "${flags.only}" not found`); process.exit(1); }
    // Include prerequisites (transitive) in order, excluding bootstrap (already done).
    const prereqs = new Set();
    const collect = (id) => {
      const e = order.find((x) => x.id === id);
      if (!e || prereqs.has(id)) return;
      for (const d of e.depends_on || []) collect(d);
      prereqs.add(id);
    };
    collect(flags.only);
    execList = order.filter((e) => prereqs.has(e.id));
  } else {
    execList = order;
  }

  let appliedCount = 0;
  for (const e of execList) {
    if (e.id === '0000') continue; // bootstrap handled above
    if (applied.has(e.id)) {
      console.log(`[migrate] skip ${e.id} (already applied)`);
      continue;
    }
    if (flags.dryRun) {
      console.log(`[dry-run] would apply ${e.id}  ${e.file}`);
      appliedCount++;
      continue;
    }
    applyEntry(dbUrl, e);
    appliedCount++;
  }

  if (flags.includeSeeds && !flags.dryRun && !flags.only) {
    for (const e of seeds) {
      if (applied.has(e.id)) { console.log(`[migrate] skip seed ${e.id} (already applied)`); continue; }
      console.log(`[migrate] applying seed ${e.id}  ${e.file}`);
      const st = execSqlFile(dbUrl, resolvePath(e.file));
      if (st !== 0) { console.error(`[migrate] seed ${e.id} FAILED`); process.exit(1); }
      recordMigration(dbUrl, { ...e, category: 'seed' });
      appliedCount++;
    }
  }

  if (flags.dryRun) {
    console.log(`\n[dry-run] ${appliedCount} migration(s) would be applied. No changes made.`);
  } else {
    console.log(`\n[migrate] done. ${appliedCount} migration(s) applied this run.`);
    // Live readiness gate (non-fatal informational).
    const { stdout } = execSqlInline(
      dbUrl,
      `COPY (SELECT version || '|' || scb_3_4b_ready::text FROM public.schema_version WHERE id = 1) TO STDOUT;`,
    );
    const line = stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0);
    if (line) {
      const [version, ready] = line.split('|');
      console.log(`[migrate] schema_version=${version}  scb_3_4b_ready=${ready}`);
      if (ready === 'false') {
        console.warn('[migrate] WARNING: scb_3_4b_ready=false — run `npm run db:verify` to see which prerequisite is missing.');
      }
    }
  }
}

main();
