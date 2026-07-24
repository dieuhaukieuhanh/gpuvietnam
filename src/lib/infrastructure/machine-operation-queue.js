/**
 * SCB 2.1 Phase 2 — Machine Operation Queue service (Supabase-backed, idempotent).
 */

import {
  MACHINE_OPERATION_STATE,
  MACHINE_OPERATION,
  DEFAULT_RETRY_POLICY,
  resolveRetryAfterFailure,
  isMachineOperationsTableUnavailable,
  isUserStartProvisionOperation,
  userStartProvisionIdempotencyKey,
  userStartProvisionReleasedIdempotencyKey,
} from './machine-operation-core.js';
import {
  LEASE_DURATION_MS,
} from './machine-operation-policies.js';
import {
  logMachineOperation,
  logContextFromOperationRow,
} from './machine-operation-observability.js';
import { buildOperationMetrics, mergeMetrics } from './machine-operation-metrics.js';
import { kickMachineOperationWorkerForRow } from './machine-operation-worker-runner.js';
import { canExecuteUserStartProvisionInThisProcess } from './user-start-execution-gate.js';

const UNIQUE_VIOLATION = '23505';

/**
 * Free per-user open provision slot after terminal outcome.
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function releasedIdempotencyPatch(row) {
  if (!isUserStartProvisionOperation(row)) return {};
  const userId = String(row.user_id ?? '');
  const operationId = String(row.id ?? '');
  if (!userId || !operationId) return {};
  return {
    idempotency_key: userStartProvisionReleasedIdempotencyKey(userId, operationId),
  };
}

/**
 * Re-claim open slot when manually retrying a terminal user_start_provision.
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function reopenIdempotencyPatch(row) {
  if (!isUserStartProvisionOperation(row)) return {};
  const userId = String(row.user_id ?? '');
  if (!userId) return {};
  return {
    idempotency_key: userStartProvisionIdempotencyKey(userId),
  };
}

function skipEnqueueWhenQueueUnavailable(error, context) {
  if (!isMachineOperationsTableUnavailable(error)) return null;
  console.warn(
    `[machine-op-queue] ${context}: machine_operations unavailable — apply supabase migrations 0030–0032 (projection-read-path.sql). Skipping enqueue.`,
    error.message,
  );
  return { operation: null, created: false, skipped: true };
}

/**
 * @typedef {Object} EnqueueInput
 * @property {string} operation
 * @property {string} userId
 * @property {string} idempotencyKey
 * @property {string} correlationId
 * @property {number} [priority]
 * @property {string|null} [machineId]
 * @property {string|null} [gpuSessionId]
 * @property {string|null} [provider]
 * @property {Record<string, unknown>} [payload]
 * @property {string} [retryPolicy]
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {EnqueueInput} input
 */
export async function enqueue(supabaseAdmin, input) {
  const row = {
    operation: input.operation,
    user_id: input.userId,
    idempotency_key: input.idempotencyKey,
    correlation_id: input.correlationId,
    priority: input.priority ?? 60,
    machine_id: input.machineId ?? null,
    gpu_session_id: input.gpuSessionId ?? null,
    provider: input.provider ?? 'clore',
    payload: input.payload ?? {},
    retry_policy: input.retryPolicy ?? DEFAULT_RETRY_POLICY,
    state: MACHINE_OPERATION_STATE.PENDING,
  };

  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .insert(row)
    .select('*')
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('machine_operations')
      .select('*')
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle();
    const infraSkip = skipEnqueueWhenQueueUnavailable(fetchError, 'enqueue dedup fetch');
    if (infraSkip) return infraSkip;
    if (fetchError) throw fetchError;
    if (!existing) throw error;
    kickMachineOperationWorkerForRow(supabaseAdmin, existing, { reason: 'enqueue_dedup' });
    return { operation: existing, created: false };
  }

  const infraSkip = skipEnqueueWhenQueueUnavailable(error, 'enqueue insert');
  if (infraSkip) return infraSkip;

  if (error) throw error;

  logMachineOperation('machine-op-queue', logContextFromOperationRow(data), 'enqueue created');
  kickMachineOperationWorkerForRow(supabaseAdmin, data, { reason: 'enqueue_created' });
  return { operation: data, created: true };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} idempotencyKey
 */
export async function findByIdempotencyKey(supabaseAdmin, idempotencyKey) {
  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (error) {
    if (isMachineOperationsTableUnavailable(error)) return null;
    throw error;
  }

  return data;
}

/**
 * Re-arm a terminal operation for another execution (same idempotency key).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} operationId
 * @param {{
 *   correlationId: string;
 *   payload?: Record<string, unknown>;
 *   priority?: number;
 * }} input
 */
export async function requeueTerminalOperation(supabaseAdmin, operationId, input) {
  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .update({
      state: MACHINE_OPERATION_STATE.PENDING,
      correlation_id: input.correlationId,
      payload: input.payload ?? {},
      priority: input.priority ?? 60,
      finished_at: null,
      lease_until: null,
      next_retry_at: null,
      last_error: null,
      failure_reason: null,
      final_error: null,
      started_at: null,
    })
    .eq('id', operationId)
    .in('state', [
      MACHINE_OPERATION_STATE.COMPLETED,
      MACHINE_OPERATION_STATE.CANCELLED,
      MACHINE_OPERATION_STATE.DEAD_LETTER,
      MACHINE_OPERATION_STATE.FAILED,
    ])
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (data) {
    logMachineOperation('machine-op-queue', logContextFromOperationRow(data), 'requeued');
    kickMachineOperationWorkerForRow(supabaseAdmin, data, { reason: 'requeue_terminal' });
  }
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ limit?: number; leaseMs?: number; now?: Date }} [options]
 */
export async function leaseNext(supabaseAdmin, options = {}) {
  const limit = options.limit ?? 1;
  const leaseMs = options.leaseMs ?? LEASE_DURATION_MS;
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();

  let query = supabaseAdmin
    .from('machine_operations')
    .select('*')
    .eq('state', MACHINE_OPERATION_STATE.PENDING)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);

  // Serverless/Vercel must not claim durable rent ops — leave them for VPS lifecycle worker.
  if (!canExecuteUserStartProvisionInThisProcess()) {
    query = query
      .neq('operation', MACHINE_OPERATION.USER_START_PROVISION)
      .neq('operation', MACHINE_OPERATION.RUNTIME_AUTO_REPLACE);
  }

  const { data: candidates, error: selectError } = await query;

  if (selectError) throw selectError;
  if (!candidates?.length) return [];

  /** @type {Record<string, unknown>[]} */
  const leased = [];

  for (const candidate of candidates) {
    const attempts = Number(candidate.attempts ?? 0) + 1;
    const leaseCount = Number(candidate.lease_count ?? 0) + 1;
    const { data, error } = await supabaseAdmin
      .from('machine_operations')
      .update({
        state: MACHINE_OPERATION_STATE.LEASED,
        lease_until: leaseUntil,
        attempts,
        lease_count: leaseCount,
        started_at: candidate.started_at ?? nowIso,
        last_error: null,
      })
      .eq('id', candidate.id)
      .eq('state', MACHINE_OPERATION_STATE.PENDING)
      .select('*')
      .maybeSingle();

    if (error) throw error;
    if (data) {
      logMachineOperation('machine-op-queue', logContextFromOperationRow(data), 'leased');
      leased.push(data);
    }
  }

  return leased;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} operationId
 * @param {{ leaseMs?: number; now?: Date }} [options]
 */
export async function markRunning(supabaseAdmin, operationId, options = {}) {
  const leaseMs = options.leaseMs ?? LEASE_DURATION_MS;
  const now = options.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();

  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .update({
      state: MACHINE_OPERATION_STATE.RUNNING,
      lease_until: leaseUntil,
    })
    .eq('id', operationId)
    .eq('state', MACHINE_OPERATION_STATE.LEASED)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Extend lease_until while a long-running op (provision) is still executing.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} operationId
 * @param {{ leaseMs?: number; now?: Date }} [options]
 */
export async function extendLease(supabaseAdmin, operationId, options = {}) {
  const leaseMs = options.leaseMs ?? LEASE_DURATION_MS;
  const now = options.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();

  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .update({ lease_until: leaseUntil })
    .eq('id', operationId)
    .eq('state', MACHINE_OPERATION_STATE.RUNNING)
    .select('id,lease_until')
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} operationId
 * @param {{ executionMs?: number; now?: Date }} [options]
 */
export async function complete(supabaseAdmin, operationId, options = {}) {
  const now = options.now ?? new Date();
  const finishedAt = now.toISOString();

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('machine_operations')
    .select('*')
    .eq('id', operationId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!current) return null;

  const metrics = mergeMetrics(current.metrics, buildOperationMetrics(current, options));

  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .update({
      state: MACHINE_OPERATION_STATE.COMPLETED,
      finished_at: finishedAt,
      lease_until: null,
      next_retry_at: null,
      last_error: null,
      metrics,
      ...releasedIdempotencyPatch(current),
    })
    .eq('id', operationId)
    .in('state', [MACHINE_OPERATION_STATE.LEASED, MACHINE_OPERATION_STATE.RUNNING])
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (data) {
    logMachineOperation(
      'machine-op-queue',
      { ...logContextFromOperationRow(data), durationMs: options.executionMs ?? null },
      'completed',
    );
  }
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} operationId
 * @param {string} errorMessage
 * @param {{ retryable?: boolean; now?: Date; retryReason?: string }} [options]
 */
export async function fail(supabaseAdmin, operationId, errorMessage, options = {}) {
  const retryable = options.retryable !== false;
  const now = options.now ?? new Date();
  const retryReason = options.retryReason ?? 'execution_failed';

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('machine_operations')
    .select('*')
    .eq('id', operationId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!current) return null;

  const attempts = Number(current.attempts ?? 0);
  const policyName = String(current.retry_policy ?? DEFAULT_RETRY_POLICY);
  const metrics = mergeMetrics(current.metrics, buildOperationMetrics(current, { now }));

  if (!retryable) {
    return moveToDeadLetter(supabaseAdmin, operationId, {
      failureReason: 'non_retryable',
      finalError: errorMessage,
      retryCount: attempts,
      metrics,
      now,
    });
  }

  const decision = resolveRetryAfterFailure(policyName, attempts, now);
  if (decision.deadLetter) {
    return moveToDeadLetter(supabaseAdmin, operationId, {
      failureReason: decision.failureReason,
      finalError: errorMessage,
      retryCount: attempts,
      metrics,
      now,
    });
  }

  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .update({
      state: MACHINE_OPERATION_STATE.RETRY_SCHEDULED,
      next_retry_at: decision.nextRetryAt.toISOString(),
      lease_until: null,
      retry_reason: retryReason,
      retry_count: attempts,
      last_error: errorMessage,
      metrics,
    })
    .eq('id', operationId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) {
    logMachineOperation('machine-op-queue', logContextFromOperationRow(data), 'retry scheduled');
  }
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} operationId
 * @param {{
 *   failureReason: string;
 *   finalError: string;
 *   retryCount: number;
 *   metrics: Record<string, unknown>;
 *   now?: Date;
 * }} input
 */
async function moveToDeadLetter(supabaseAdmin, operationId, input) {
  const now = input.now ?? new Date();
  const { data: current } = await supabaseAdmin
    .from('machine_operations')
    .select('id,user_id,operation')
    .eq('id', operationId)
    .maybeSingle();

  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .update({
      state: MACHINE_OPERATION_STATE.DEAD_LETTER,
      finished_at: now.toISOString(),
      lease_until: null,
      next_retry_at: null,
      failure_reason: input.failureReason,
      final_error: input.finalError,
      retry_count: input.retryCount,
      last_error: input.finalError,
      metrics: input.metrics,
      ...(current ? releasedIdempotencyPatch(current) : {}),
    })
    .eq('id', operationId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) {
    logMachineOperation('machine-op-queue', logContextFromOperationRow(data), 'dead letter');
  }
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} operationId
 */
export async function retry(supabaseAdmin, operationId) {
  const { data: current, error: fetchError } = await supabaseAdmin
    .from('machine_operations')
    .select('id,user_id,operation')
    .eq('id', operationId)
    .maybeSingle();
  if (fetchError) throw fetchError;

  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .update({
      state: MACHINE_OPERATION_STATE.PENDING,
      lease_until: null,
      next_retry_at: null,
      finished_at: null,
      failure_reason: null,
      final_error: null,
      last_error: null,
      retry_reason: 'manual_retry',
      ...(current ? reopenIdempotencyPatch(current) : {}),
    })
    .eq('id', operationId)
    .in('state', [
      MACHINE_OPERATION_STATE.DEAD_LETTER,
      MACHINE_OPERATION_STATE.FAILED,
      MACHINE_OPERATION_STATE.RETRY_SCHEDULED,
      MACHINE_OPERATION_STATE.CANCELLED,
    ])
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) {
    logMachineOperation('machine-op-queue', logContextFromOperationRow(data), 'manual retry');
    kickMachineOperationWorkerForRow(supabaseAdmin, data, { reason: 'manual_retry' });
  }
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} operationId
 * @param {string} [reason]
 */
export async function cancel(supabaseAdmin, operationId, reason) {
  const { data: current, error: fetchError } = await supabaseAdmin
    .from('machine_operations')
    .select('id,user_id,operation')
    .eq('id', operationId)
    .maybeSingle();
  if (fetchError) throw fetchError;

  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .update({
      state: MACHINE_OPERATION_STATE.CANCELLED,
      finished_at: new Date().toISOString(),
      lease_until: null,
      next_retry_at: null,
      last_error: reason ?? null,
      ...(current ? releasedIdempotencyPatch(current) : {}),
    })
    .eq('id', operationId)
    .in('state', [
      MACHINE_OPERATION_STATE.PENDING,
      MACHINE_OPERATION_STATE.RETRY_SCHEDULED,
      MACHINE_OPERATION_STATE.LEASED,
    ])
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) {
    logMachineOperation('machine-op-queue', logContextFromOperationRow(data), 'cancelled');
  }
  return data;
}

export {
  enqueue as enqueueOperation,
  leaseNext as leaseNextOperation,
  complete as completeOperation,
  fail as failOperation,
  retry as retryOperation,
  cancel as cancelOperation,
};
