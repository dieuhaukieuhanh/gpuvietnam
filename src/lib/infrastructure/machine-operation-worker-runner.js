/**
 * SCB 2.1 — In-process MachineOperation worker runner.
 * Primary execution path: kick after enqueue. Cron remains recovery-only.
 *
 * In-process dedup: one drain loop per Node process (coalesced kicks).
 * Cross-instance dedup: leaseNext() optimistic locking in machine_operations.
 */

import { MACHINE_OPERATION_STATE } from './machine-operation-core.js';
import { logMachineOperation } from './machine-operation-observability.js';

const DEFAULT_BATCH_LIMIT = 5;
const DEFAULT_MAX_DRAIN_BATCHES = 50;
const DEFAULT_BACKGROUND_INTERVAL_MS = 30_000;

/** @type {Promise<void> | null} */
let activeDrain = null;
let rerunRequested = false;

/** @type {ReturnType<typeof setInterval> | null} */
let backgroundInterval = null;

function resolveBatchLimit(options = {}) {
  const fromOptions = Number(options.limit);
  if (Number.isFinite(fromOptions) && fromOptions > 0) {
    return Math.min(fromOptions, 20);
  }
  const fromEnv = Number(process.env.SCB_MACHINE_OP_BATCH_LIMIT ?? DEFAULT_BATCH_LIMIT);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? Math.min(fromEnv, 20) : DEFAULT_BATCH_LIMIT;
}

function resolveMaxDrainBatches() {
  const fromEnv = Number(process.env.SCB_MACHINE_OP_MAX_DRAIN_BATCHES ?? DEFAULT_MAX_DRAIN_BATCHES);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_DRAIN_BATCHES;
}

/**
 * Fire-and-forget: drain pending machine_operations until idle.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ limit?: number; gpuService?: import('@/lib/gpu/gpu-service').GPUService | null; reason?: string }} [options]
 */
export function kickMachineOperationWorker(supabaseAdmin, options = {}) {
  if (!supabaseAdmin) return;
  void ensureDrain(supabaseAdmin, options).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[machine-op-runner] drain failed:', message);
  });
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ limit?: number; gpuService?: import('@/lib/gpu/gpu-service').GPUService | null; reason?: string }} [options]
 */
function ensureDrain(supabaseAdmin, options) {
  if (activeDrain) {
    rerunRequested = true;
    return activeDrain;
  }

  activeDrain = runDrainUntilIdle(supabaseAdmin, options).finally(() => {
    activeDrain = null;
    if (rerunRequested) {
      rerunRequested = false;
      void ensureDrain(supabaseAdmin, options).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[machine-op-runner] coalesced drain failed:', message);
      });
    }
  });

  return activeDrain;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ limit?: number; gpuService?: import('@/lib/gpu/gpu-service').GPUService | null; reason?: string }} [options]
 */
async function runDrainUntilIdle(supabaseAdmin, options) {
  const { processMachineOperationBatch } = await import('./machine-operation-worker.js');
  const limit = resolveBatchLimit(options);
  const maxBatches = resolveMaxDrainBatches();
  let batches = 0;
  let totalProcessed = 0;

  logMachineOperation(
    'machine-op-runner',
    {
      correlationId: null,
      operationId: null,
      durationMs: null,
      extra: { reason: options.reason ?? 'kick', limit },
    },
    'drain start',
  );

  while (batches < maxBatches) {
    const result = await processMachineOperationBatch(supabaseAdmin, {
      limit,
      gpuService: options.gpuService,
    });
    batches += 1;
    totalProcessed += result.processed;
    if (result.processed === 0) break;
  }

  logMachineOperation(
    'machine-op-runner',
    {
      correlationId: null,
      operationId: null,
      durationMs: null,
      extra: { reason: options.reason ?? 'kick', batches, totalProcessed },
    },
    'drain idle',
  );
}

/**
 * Wake worker when queue row may need execution (pending or awaiting retry promotion).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>|null|undefined} operation
 * @param {{ reason?: string }} [options]
 */
export function kickMachineOperationWorkerForRow(supabaseAdmin, operation, options = {}) {
  if (!supabaseAdmin || !operation) return;
  const state = String(operation.state ?? '');
  if (
    state !== MACHINE_OPERATION_STATE.PENDING &&
    state !== MACHINE_OPERATION_STATE.RETRY_SCHEDULED
  ) {
    return;
  }
  kickMachineOperationWorker(supabaseAdmin, {
    reason: options.reason ?? `row_${state}`,
  });
}

/**
 * Long-running Node recovery loop (retries, stale pending after restart).
 * Disabled when SCB_MACHINE_OP_BACKGROUND_INTERVAL_MS=0.
 */
export function startMachineOperationBackgroundWorker() {
  if (backgroundInterval) return;

  const intervalMs = Number(
    process.env.SCB_MACHINE_OP_BACKGROUND_INTERVAL_MS ?? DEFAULT_BACKGROUND_INTERVAL_MS,
  );
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;

  backgroundInterval = setInterval(() => {
    void (async () => {
      try {
        const { getSupabaseAdmin } = await import('@/lib/supabase-admin');
        kickMachineOperationWorker(getSupabaseAdmin(), { reason: 'background_tick' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[machine-op-runner] background tick skipped:', message);
      }
    })();
  }, intervalMs);

  if (typeof backgroundInterval.unref === 'function') {
    backgroundInterval.unref();
  }

  logMachineOperation(
    'machine-op-runner',
    {
      correlationId: null,
      operationId: null,
      durationMs: null,
      extra: { intervalMs },
    },
    'background worker started',
  );
}

/** Test-only reset for in-process runner state. */
export function resetMachineOperationWorkerRunnerForTests() {
  activeDrain = null;
  rerunRequested = false;
  if (backgroundInterval) {
    clearInterval(backgroundInterval);
    backgroundInterval = null;
  }
}
