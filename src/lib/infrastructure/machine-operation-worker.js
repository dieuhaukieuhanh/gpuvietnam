/**
 * SCB 2.1 Phase 2 — Worker executes machine_operations.
 * Destroy operations call destroyUserMachine → runDestroyPipeline (SCB Core unchanged).
 */

import { getGpuService } from '@/lib/gpu';
import { executeSubscriptionMachineDriftRepair } from '@/lib/machines-drift';
import { completeUserStartProvision } from '@/lib/gpu/user-start-provision';
import { completeRuntimeAutoReplace } from '@/lib/gpu/runtime-auto-replace';
import {
  detectResultFromOperationPayload,
  MACHINE_OPERATION,
} from './machine-operation-core.js';
import { PROVISION_LEASE_MS } from './machine-operation-policies.js';
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
  extendLease,
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
  const opType = String(row.operation);
  const isProjectionVerify = opType === MACHINE_OPERATION.PROJECTION_VERIFY;
  const isUserStartProvision = opType === MACHINE_OPERATION.USER_START_PROVISION;
  const isRuntimeAutoReplace = opType === MACHINE_OPERATION.RUNTIME_AUTO_REPLACE;
  const pvTrace = isProjectionVerify ? createProjectionVerifyTraceContext(row) : null;

  const running = await markRunning(supabaseAdmin, operationId, {
    leaseMs:
      isUserStartProvision || isRuntimeAutoReplace ? PROVISION_LEASE_MS : undefined,
  });
  if (isProjectionVerify) {
    logProjectionVerifyTrace('markRunning()', pvTrace, {
      success: Boolean(running),
      state: running?.state ? String(running.state) : null,
    });
  }
  if (!running) return { outcome: 'skipped' };

  logMachineOperation('machine-op-worker', { ...ctx, state: 'running' }, 'execute start');

  /** @type {ReturnType<typeof setInterval> | null} */
  let provisionHeartbeat = null;
  if (isUserStartProvision || isRuntimeAutoReplace) {
    provisionHeartbeat = setInterval(() => {
      void extendLease(supabaseAdmin, operationId, { leaseMs: PROVISION_LEASE_MS }).catch(() => {
        /* best-effort; self-heal uses lease_until */
      });
    }, 60_000);
  }

  try {
    if (isProjectionVerify) {
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
    } else if (isUserStartProvision) {
      const payload =
        row.payload && typeof row.payload === 'object'
          ? /** @type {Record<string, unknown>} */ (row.payload)
          : {};
      const subscriptionId = String(payload.subscriptionId ?? '');
      if (!subscriptionId) {
        throw new Error('user_start_provision payload missing subscriptionId');
      }

      const { listActiveMachinesForUser } = await import('../machines.js');
      const activeMachines = await listActiveMachinesForUser(
        supabaseAdmin,
        String(payload.userId ?? userId),
      );
      if (activeMachines.length > 0) {
        logMachineOperation(
          'machine-op-worker',
          {
            ...ctx,
            machineId: activeMachines[0]?.id != null ? String(activeMachines[0].id) : null,
          },
          'user_start_provision skipped — user already has active machine',
        );
        const executionMs = Date.now() - startedMs;
        await complete(supabaseAdmin, operationId, { executionMs });
        return { outcome: 'completed', skippedRent: true };
      }

      const { data: subscription, error: subErr } = await supabaseAdmin
        .from('subscriptions')
        .select('*')
        .eq('id', subscriptionId)
        .maybeSingle();
      if (subErr) throw subErr;
      if (!subscription) {
        throw new Error(`subscription not found: ${subscriptionId}`);
      }

      await completeUserStartProvision(supabaseAdmin, {
        userId: String(payload.userId ?? userId),
        subscriptionId,
        subscription,
        selected: payload.selected && typeof payload.selected === 'object' ? payload.selected : {},
        planKey: String(payload.planKey ?? ''),
        planName: String(payload.planName ?? ''),
        gpuLine: String(payload.gpuLine ?? ''),
        envName: String(payload.envName ?? ''),
        workstationContainerEnv:
          payload.workstationContainerEnv && typeof payload.workstationContainerEnv === 'object'
            ? payload.workstationContainerEnv
            : null,
        backupTokenId: payload.backupTokenId != null ? String(payload.backupTokenId) : null,
        lifecycleCtx:
          payload.lifecycleCtx && typeof payload.lifecycleCtx === 'object'
            ? payload.lifecycleCtx
            : null,
        correlationId: String(payload.correlationId ?? row.correlation_id ?? ''),
        provisionLabel: String(payload.provisionLabel ?? ''),
      });

      // Belt-and-suspenders: never mark the durable op completed with no GPU.
      const afterMachines = await listActiveMachinesForUser(
        supabaseAdmin,
        String(payload.userId ?? userId),
      );
      if (afterMachines.length === 0) {
        throw new Error(
          'user_start_provision finished without an active machine (rent failed or silent return)',
        );
      }
    } else if (isRuntimeAutoReplace) {
      const payload =
        row.payload && typeof row.payload === 'object'
          ? /** @type {Record<string, unknown>} */ (row.payload)
          : {};
      await completeRuntimeAutoReplace(supabaseAdmin, {
        userId: String(payload.userId ?? userId),
        sessionId: String(payload.sessionId ?? ''),
        oldMachineId: String(payload.oldMachineId ?? row.machine_id ?? ''),
        subscriptionId: String(payload.subscriptionId ?? ''),
        planKey: String(payload.planKey ?? 'pro'),
        planName: String(payload.planName ?? 'Pro'),
        gpuLine: String(payload.gpuLine ?? 'rtx_4090'),
        envName: String(payload.envName ?? 'ComfyUI'),
        billingStartedAt: String(payload.billingStartedAt ?? ''),
        correlationId: String(payload.correlationId ?? row.correlation_id ?? ''),
      });
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
      opType === MACHINE_OPERATION.PROJECTION_VERIFY
        ? 'projection verify completed'
        : opType === MACHINE_OPERATION.USER_START_PROVISION
          ? 'user start provision completed'
          : opType === MACHINE_OPERATION.RUNTIME_AUTO_REPLACE
            ? 'runtime auto-replace completed'
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
  } finally {
    if (provisionHeartbeat) clearInterval(provisionHeartbeat);
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
