/**
 * P0-A Always-on Lifecycle Worker (VPS Linux).
 *
 * Loops:
 *  - machine_operations drain (incl. user_start_provision)
 *  - Clore orphan reconciliation
 *  - infrastructure reconciliation (settlement retry) on interval
 *
 * Usage:
 *   node --import ./scripts/register-src-alias.mjs scripts/lifecycle-worker.mjs
 *
 * Env: same as Next (.env.local or process env) — Supabase service role, Clore, etc.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const p = join(root, '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    const k = t.slice(0, i).trim();
    if (process.env[k] == null) process.env[k] = v;
  }
}

loadEnv();
// EnvironmentFile with Windows CRLF leaves trailing \r on values — break === 'true'.
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === 'string' && v.includes('\r')) {
    process.env[k] = v.replace(/\r/g, '');
  }
}
process.env.GPUVIETNAM_LIFECYCLE_WORKER = '1';
process.env.GPUVIETNAM_LIFECYCLE_OWNER =
  process.env.GPUVIETNAM_LIFECYCLE_OWNER ||
  `lifecycle-worker-${hostname()}-${process.pid}`;

const RECONCILE_INTERVAL_MS = Number(
  process.env.LIFECYCLE_RECONCILE_INTERVAL_MS || 15 * 60_000,
);

/** @type {ReturnType<typeof setInterval> | null} */
let reconcileTimer = null;
let shuttingDown = false;

async function main() {
  const { initLogging, logStartupDiagnostics, logger } = await import(
    '../src/lib/logging/index.js'
  );
  initLogging();
  logStartupDiagnostics();
  const log = logger('worker');
  const { isCloreOnlyMode } = await import('../src/lib/gpu/provider-routing.js');
  const cloreOnly = isCloreOnlyMode();
  log.info(
    {
      GPU_CLORE_ONLY: process.env.GPU_CLORE_ONLY ?? null,
      GPU_ALLOW_VAST: process.env.GPU_ALLOW_VAST ?? null,
      GPUVIETNAM_LIFECYCLE_WORKER: process.env.GPUVIETNAM_LIFECYCLE_WORKER ?? null,
      cloreOnlyActive: cloreOnly,
      GPU_VAST_ONLY: process.env.GPU_VAST_ONLY ?? null,
    },
    'lifecycle worker provider flags',
  );
  if (!cloreOnly) {
    log.warn(
      {
        GPU_CLORE_ONLY: process.env.GPU_CLORE_ONLY ?? null,
        GPU_ALLOW_VAST: process.env.GPU_ALLOW_VAST ?? null,
      },
      'Clore-only inactive — Start may rent Vast (disk-only risk)',
    );
  }

  const { getSupabaseAdmin } = await import('../src/lib/supabase-admin.js');
  const supabaseAdmin = getSupabaseAdmin();

  const { startMachineOperationBackgroundWorker, kickMachineOperationWorker } =
    await import('../src/lib/infrastructure/machine-operation-worker-runner.js');
  const { startCloreOrphanReconciliation } = await import(
    '../src/lib/gpu/providers/clore/clore-orphan-runner.js'
  );
  const { executeReconciliation } = await import(
    '../src/lib/infrastructure/reconciliation-run.js'
  );

  startMachineOperationBackgroundWorker();
  startCloreOrphanReconciliation();

  // Immediate kick so pending provisions do not wait for first 30s tick
  kickMachineOperationWorker(supabaseAdmin, { reason: 'lifecycle_boot' });

  if (Number.isFinite(RECONCILE_INTERVAL_MS) && RECONCILE_INTERVAL_MS > 0) {
    const runReconcile = async (reason) => {
      if (shuttingDown) return;
      try {
        const result = await executeReconciliation(supabaseAdmin, { repair: true });
        log.info(
          {
            operation: 'lifecycle.reconcile',
            phase: 'SUCCESS',
            reason,
            health: result?.health ?? null,
          },
          'infrastructure reconciliation tick',
        );
      } catch (err) {
        log.error(
          {
            operation: 'lifecycle.reconcile',
            phase: 'FAILURE',
            err: { message: err instanceof Error ? err.message : String(err) },
          },
          'infrastructure reconciliation failed',
        );
      }
    };
    void runReconcile('boot');
    reconcileTimer = setInterval(() => {
      void runReconcile('interval');
    }, RECONCILE_INTERVAL_MS);
  }

  log.info(
    {
      operation: 'lifecycle.boot',
      phase: 'SUCCESS',
      owner: process.env.GPUVIETNAM_LIFECYCLE_OWNER,
      reconcileIntervalMs: RECONCILE_INTERVAL_MS,
    },
    'P0-A lifecycle worker ready',
  );

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ operation: 'lifecycle.shutdown', signal }, 'graceful shutdown');
    if (reconcileTimer) clearInterval(reconcileTimer);
    // Keep process alive briefly so in-flight drain can finish lease heartbeat
    setTimeout(() => process.exit(0), 2_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[lifecycle-worker] fatal', err);
  process.exit(1);
});
