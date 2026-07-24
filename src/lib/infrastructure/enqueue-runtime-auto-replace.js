/**
 * P1 — Enqueue durable runtime_auto_replace (one open slot per dead machine).
 */

import {
  evaluateRuntimeAutoReplaceEligibility,
  runtimeAutoReplaceIdempotencyKey,
} from '../gpu/runtime-auto-replace-core.js';
import {
  MACHINE_OPERATION,
  MACHINE_OPERATION_STATE,
  PRIORITY_CLASS,
  isActiveQueueState,
} from './machine-operation-core.js';
import { enqueue } from './machine-operation-queue.js';

const ACTIVE_OP_STATES = [
  MACHINE_OPERATION_STATE.PENDING,
  MACHINE_OPERATION_STATE.LEASED,
  MACHINE_OPERATION_STATE.RUNNING,
  MACHINE_OPERATION_STATE.RETRY_SCHEDULED,
];

export { runtimeAutoReplaceIdempotencyKey };

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {string} sessionId
 */
export async function findActiveRuntimeAutoReplace(supabaseAdmin, userId, sessionId) {
  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .select('*')
    .eq('user_id', userId)
    .eq('operation', MACHINE_OPERATION.RUNTIME_AUTO_REPLACE)
    .in('state', ACTIVE_OP_STATES)
    .order('created_at', { ascending: false })
    .limit(8);

  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return (
    rows.find((row) => {
      if (!isActiveQueueState(row)) return false;
      const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
      return String(payload.sessionId ?? '') === String(sessionId);
    }) ?? null
  );
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {string} sessionId
 * @param {string} oldMachineId
 */
export async function findDeadLetterRuntimeAutoReplace(
  supabaseAdmin,
  userId,
  sessionId,
  oldMachineId,
) {
  const key = runtimeAutoReplaceIdempotencyKey(userId, sessionId, oldMachineId);
  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .select('id, state, idempotency_key')
    .eq('user_id', userId)
    .eq('operation', MACHINE_OPERATION.RUNTIME_AUTO_REPLACE)
    .eq('idempotency_key', key)
    .eq('state', MACHINE_OPERATION_STATE.DEAD_LETTER)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   userId: string;
 *   sessionId: string;
 *   oldMachineId: string;
 *   subscriptionId: string;
 *   planKey: string;
 *   planName: string;
 *   gpuLine: string;
 *   envName: string;
 *   billingStartedAt: string;
 *   correlationId?: string;
 *   provider?: string|null;
 *   session?: Record<string, unknown>|null;
 *   userCloseRequested?: boolean;
 *   policyStopRequested?: boolean;
 *   outOfCredit?: boolean;
 * }} input
 */
export async function enqueueRuntimeAutoReplace(supabaseAdmin, input) {
  const userId = String(input.userId);
  const sessionId = String(input.sessionId);
  const oldMachineId = String(input.oldMachineId);

  let session = input.session ?? null;
  if (!session) {
    const { data, error } = await supabaseAdmin
      .from('gpu_sessions')
      .select('id, status, started_at, ended_at, close_requested_at')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw error;
    session = data;
  }

  const active = await findActiveRuntimeAutoReplace(supabaseAdmin, userId, sessionId);
  const deadLetter = await findDeadLetterRuntimeAutoReplace(
    supabaseAdmin,
    userId,
    sessionId,
    oldMachineId,
  );

  const decision = evaluateRuntimeAutoReplaceEligibility(session, {
    userCloseRequested: input.userCloseRequested === true,
    policyStopRequested: input.policyStopRequested === true,
    outOfCredit: input.outOfCredit === true,
    hasActiveReplaceOp: Boolean(active),
    replaceDeadLetteredForMachine: Boolean(deadLetter),
  });

  if (!decision.allow) {
    return {
      operation: active,
      created: false,
      skipped: true,
      deduped: Boolean(active),
      reason: decision.reason,
    };
  }

  if (active) {
    return { operation: active, created: false, deduped: true, reason: 'replace_already_in_flight' };
  }

  const correlationId =
    input.correlationId ||
    `rar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const payload = {
    userId,
    sessionId,
    oldMachineId,
    subscriptionId: input.subscriptionId,
    planKey: input.planKey,
    planName: input.planName,
    gpuLine: input.gpuLine,
    envName: input.envName,
    billingStartedAt: input.billingStartedAt,
    correlationId,
  };

  const result = await enqueue(supabaseAdmin, {
    operation: MACHINE_OPERATION.RUNTIME_AUTO_REPLACE,
    userId,
    idempotencyKey: runtimeAutoReplaceIdempotencyKey(userId, sessionId, oldMachineId),
    correlationId,
    priority: PRIORITY_CLASS.RECOVER,
    machineId: oldMachineId,
    gpuSessionId: sessionId,
    provider: input.provider ?? null,
    payload,
    retryPolicy: 'runtime_auto_replace',
  });

  if (result.skipped) {
    console.warn(
      '[enqueue-runtime-auto-replace] skipped — apply migration 0051 (p1-runtime-auto-replace-op.sql)',
    );
  }

  return {
    ...result,
    deduped: !result.created,
    reason: result.created ? 'enqueued' : 'deduped_or_skipped',
  };
}
