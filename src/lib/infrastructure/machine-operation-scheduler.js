/**
 * SCB 2.1 Phase 2 — Scheduler for machine_operations.
 * Handles priority registry, dedupe, self-healing prep.
 * Does NOT call Provider or runDestroyPipeline directly.
 */

import { createCorrelationId } from '@/lib/scb-correlation';
import { getActiveMachineForUser } from '@/lib/machines';
import { isProjectionVerificationStale } from '@/lib/scb-read-path';
import { logMachineOperation } from './machine-operation-observability.js';
import {
  buildDriftIdempotencyKey,
  DEFAULT_RETRY_POLICY,
  isTerminalQueueState,
  MACHINE_OPERATION,
  MACHINE_OPERATION_STATE,
  priorityForOperation,
  projectionVerifyIdempotencyKey,
  projectionVerifySkipReason,
  repairKindToOperation,
  resolveProviderFromMachine,
} from './machine-operation-core.js';
import { PENDING_STALE_MS } from './machine-operation-policies.js';
import { cancel, enqueue, findByIdempotencyKey, requeueTerminalOperation } from './machine-operation-queue.js';
import { runQueueSelfHealing } from './machine-operation-self-heal.js';
import { kickMachineOperationWorker } from './machine-operation-worker-runner.js';

/**
 * @typedef {Object} ScheduleDriftOptions
 * @property {string} [correlationId]
 * @property {string} [source]
 */

/**
 * Prepare queue for worker: self-healing before lease.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ now?: Date }} [options]
 */
export async function prepareMachineOperationQueue(supabaseAdmin, options = {}) {
  return runQueueSelfHealing(supabaseAdmin, options);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{
 *   changed?: boolean;
 *   machine?: Record<string, unknown>|null;
 *   subscription?: Record<string, unknown>|null;
 *   action?: string|null;
 *   repair?: Record<string, unknown>|null;
 * }|null|undefined} detectResult
 * @param {ScheduleDriftOptions} [options]
 */
export async function scheduleDriftRepair(supabaseAdmin, userId, detectResult, options = {}) {
  if (!detectResult?.repair) return null;

  const repair = detectResult.repair;
  const operation = repairKindToOperation(String(repair.kind ?? ''));
  if (!operation) {
    throw new Error(`Unsupported drift repair kind: ${repair.kind ?? 'unknown'}`);
  }

  const correlationId = createCorrelationId(options.correlationId);
  const idempotencyKey = buildDriftIdempotencyKey(
    userId,
    detectResult.action ?? null,
    /** @type {{ kind?: string; machine?: Record<string, unknown>|null }} */ (repair),
  );

  const machineRecord = detectResult.machine ?? repair.machine ?? null;
  const machineId = machineRecord?.id != null ? String(machineRecord.id) : null;
  const gpuSessionId =
    machineRecord?.gpu_session_id != null ? String(machineRecord.gpu_session_id) : null;
  const provider = resolveProviderFromMachine(
    /** @type {Record<string, unknown>|null} */ (machineRecord),
  );

  const payload = {
    action: detectResult.action ?? null,
    repair,
    machine: machineRecord,
    subscription: detectResult.subscription ?? null,
    source: options.source ?? 'read_path_drift',
    correlationId,
  };

  logMachineOperation(
    'machine-op-scheduler',
    {
      correlationId,
      operationId: null,
      machineId,
      provider,
      operation,
      state: 'pending',
    },
    'schedule drift repair',
  );

  return enqueue(supabaseAdmin, {
    operation,
    userId,
    idempotencyKey,
    correlationId,
    priority: priorityForOperation(operation),
    machineId,
    gpuSessionId,
    provider,
    payload,
    retryPolicy: DEFAULT_RETRY_POLICY,
  });
}

/**
 * Schedule async provider verification (AF v2). Deduped per user+machine.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{
 *   correlationId?: string;
 *   source?: string;
 *   machineId?: string|null;
 *   machine?: Record<string, unknown>|null;
 * }} [options]
 */
export async function scheduleProjectionVerification(supabaseAdmin, userId, options = {}) {
  const machine =
    'machine' in options
      ? options.machine
      : await getActiveMachineForUser(supabaseAdmin, userId);

  const staleMs = Number(process.env.SCB_PROJECTION_VERIFY_STALE_MS ?? 30_000);
  if (machine && !isProjectionVerificationStale(machine, staleMs)) {
    return null;
  }

  const correlationId = createCorrelationId(options.correlationId);
  const machineId = options.machineId ?? (machine?.id != null ? String(machine.id) : null);
  const idempotencyKey = projectionVerifyIdempotencyKey(userId, machineId);
  const provider = resolveProviderFromMachine(machine);
  const operation = MACHINE_OPERATION.PROJECTION_VERIFY;

  const existing = await findByIdempotencyKey(supabaseAdmin, idempotencyKey);
  let skipReason = projectionVerifySkipReason(existing);
  if (skipReason && existing) {
    const createdMs = Date.parse(String(existing.created_at ?? ''));
    const pendingTooLong =
      String(existing.state ?? '') === MACHINE_OPERATION_STATE.PENDING &&
      Number.isFinite(createdMs) &&
      Date.now() - createdMs > PENDING_STALE_MS;
    if (pendingTooLong) {
      await cancel(supabaseAdmin, String(existing.id), 'stale_pending_replaced');
      skipReason = null;
    }
  }
  if (skipReason) {
    if (skipReason === 'already_pending') {
      kickMachineOperationWorker(supabaseAdmin, { reason: 'schedule_already_pending' });
    }
    logMachineOperation(
      'machine-op-scheduler',
      {
        correlationId,
        operationId: existing?.id != null ? String(existing.id) : null,
        machineId,
        provider,
        operation,
        state: existing?.state ? String(existing.state) : 'pending',
      },
      `projection verify skipped (${skipReason})`,
    );
    return { operation: existing, created: false, skipped: true, skipReason };
  }

  const payload = {
    source: options.source ?? 'projection_verify',
    correlationId,
  };

  const enqueueInput = {
    operation,
    userId,
    idempotencyKey,
    correlationId,
    priority: priorityForOperation(operation),
    machineId,
    gpuSessionId: machine?.gpu_session_id != null ? String(machine.gpu_session_id) : null,
    provider,
    payload,
    retryPolicy: DEFAULT_RETRY_POLICY,
  };

  if (existing && isTerminalQueueState(existing)) {
    const requeued = await requeueTerminalOperation(supabaseAdmin, String(existing.id), {
      correlationId,
      payload,
      priority: enqueueInput.priority,
    });
    if (requeued) {
      logMachineOperation(
        'machine-op-scheduler',
        {
          correlationId,
          operationId: String(requeued.id),
          machineId,
          provider,
          operation,
          state: 'pending',
        },
        'projection verify scheduled',
      );
      return { operation: requeued, created: false, requeued: true };
    }
  }

  logMachineOperation(
    'machine-op-scheduler',
    {
      correlationId,
      operationId: null,
      machineId,
      provider,
      operation,
      state: 'pending',
    },
    'projection verify scheduled',
  );

  return enqueue(supabaseAdmin, enqueueInput);
}
