/**
 * SCB 2.1 Phase 2 — Worker executes machine_operations.
 * Destroy operations call destroyUserMachine → runDestroyPipeline (SCB Core unchanged).
 */

import { getGpuService } from '@/lib/gpu';
import { executeSubscriptionMachineDriftRepair } from '@/lib/machines-drift';
import {
  detectResultFromOperationPayload,
  MACHINE_OPERATION,
} from './machine-operation-core.js';
import { logMachineOperation, logContextFromOperationRow } from './machine-operation-observability.js';
import { logQueueMetricsSnapshot } from './machine-operation-metrics.js';
import { prepareMachineOperationQueue } from './machine-operation-scheduler.js';
import { runProjectionVerificationPipeline } from './projection-verification-pipeline.js';
import {
  createProjectionVerifyTraceContext,
  logProjectionVerifyTrace,
} from './projection-verify-trace.js';
import {
  complete,
  fail,
  leaseNext,
  markRunning,
} from './machine-operation-queue.js';

/**
 * @param {Record<string, unknown>} row
 */
export function detectResultFromOperationRow(row) {
  return detectResultFromOperationPayload(row);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} row
 * @param {import('@/lib/gpu/gpu-service').GPUService | null | undefined} gpuService
 */
export async function executeMachineOperationRow(supabaseAdmin, row, gpuService) {
  const operationId = String(row.id);
  const userId = String(row.user_id);
  const ctx = logContextFromOperationRow(row);
  const startedMs = Date.now();
  const isProjectionVerify = String(row.operation) === MACHINE_OPERATION.PROJECTION_VERIFY;
  const pvTrace = isProjectionVerify ? createProjectionVerifyTraceContext(row) : null;

  const running = await markRunning(supabaseAdmin, operationId);
  if (isProjectionVerify) {
    logProjectionVerifyTrace('markRunning()', pvTrace, {
      success: Boolean(running),
      state: running?.state ? String(running.state) : null,
    });
  }
  if (!running) return { outcome: 'skipped' };

  logMachineOperation('machine-op-worker', { ...ctx, state: 'running' }, 'execute start');

  try {
    if (String(row.operation) === MACHINE_OPERATION.PROJECTION_VERIFY) {
      const payload =
        row.payload && typeof row.payload === 'object'
          ? /** @type {Record<string, unknown>} */ (row.payload)
          : {};

      await runProjectionVerificationPipeline(
        supabaseAdmin,
        gpuService ?? getGpuService(),
        userId,
        {
          correlationId: String(row.correlation_id ?? ''),
          source: typeof payload.source === 'string' ? payload.source : 'worker',
          machineId: row.machine_id ? String(row.machine_id) : null,
          pvTrace,
        },
      );
    } else {
      const detectResult = detectResultFromOperationRow(row);
      if (!detectResult.repair) {
        throw new Error('Operation payload missing repair spec');
      }

      await executeSubscriptionMachineDriftRepair(
        supabaseAdmin,
        gpuService ?? getGpuService(),
        userId,
        detectResult,
      );
    }

    const executionMs = Date.now() - startedMs;
    if (isProjectionVerify) {
      logProjectionVerifyTrace('completeOperation()', pvTrace, {
        phase: 'enter',
        execution_ms: executionMs,
      });
    }
    await complete(supabaseAdmin, operationId, { executionMs });
    if (isProjectionVerify) {
      logProjectionVerifyTrace('completeOperation()', pvTrace, {
        phase: 'result',
        execution_ms: executionMs,
      });
    }
    const completeMessage =
      String(row.operation) === MACHINE_OPERATION.PROJECTION_VERIFY
        ? 'projection verify completed'
        : 'execute complete';
    logMachineOperation(
      'machine-op-worker',
      { ...ctx, state: 'completed', durationMs: executionMs },
      completeMessage,
    );
    return { outcome: 'completed', executionMs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const executionMs = Date.now() - startedMs;
    logMachineOperation(
      'machine-op-worker',
      { ...ctx, state: 'failed', durationMs: executionMs, extra: { error: message } },
      'execute failed',
    );
    const failedRow = await fail(supabaseAdmin, operationId, message, {
      retryable: true,
      retryReason: 'worker_execution_failed',
    });
    const outcome =
      failedRow && String(failedRow.state) === 'dead_letter' ? 'dead_letter' : 'retry_scheduled';
    return { outcome, executionMs, error: message };
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ limit?: number; gpuService?: import('@/lib/gpu/gpu-service').GPUService | null }} [options]
 */
export async function processMachineOperationBatch(supabaseAdmin, options = {}) {
  const limit = options.limit ?? 5;
  const gpuService = options.gpuService ?? getGpuService();
  const selfHeal = await prepareMachineOperationQueue(supabaseAdmin);
  const leased = await leaseNext(supabaseAdmin, { limit });

  logProjectionVerifyTrace('leaseNext() result', null, {
    leased_count: leased.length,
    operations: leased.map((row) => ({
      id: row.id != null ? String(row.id) : null,
      operation: row.operation != null ? String(row.operation) : null,
      state: row.state != null ? String(row.state) : null,
      machine_id: row.machine_id != null ? String(row.machine_id) : null,
      correlation_id: row.correlation_id != null ? String(row.correlation_id) : null,
    })),
  });

  /** @type {{ processed: number; completed: number; retried: number; deadLetter: number; failed: number; selfHeal: typeof selfHeal }} */
  const batch = {
    processed: 0,
    completed: 0,
    retried: 0,
    deadLetter: 0,
    failed: 0,
    selfHeal,
  };

  for (const row of leased) {
    batch.processed += 1;
    const result = await executeMachineOperationRow(supabaseAdmin, row, gpuService);
    if (result.outcome === 'completed') batch.completed += 1;
    else if (result.outcome === 'dead_letter') batch.deadLetter += 1;
    else if (result.outcome === 'retry_scheduled') batch.retried += 1;
    else if (result.outcome === 'failed') batch.failed += 1;
  }

  if (batch.processed > 0) {
    logQueueMetricsSnapshot(batch);
  }

  return { processed: batch.processed, prepared: selfHeal, batch };
}
