/**
 * P1 — Enqueue durable runtime_auto_replace (one open slot per session).
 */

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

/**
 * @param {string} userId
 * @param {string} sessionId
 */
export function runtimeAutoReplaceIdempotencyKey(userId, sessionId) {
  return `runtime_auto_replace:open:${userId}:${sessionId}`;
}

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
    .limit(5);

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
 * }} input
 */
export async function enqueueRuntimeAutoReplace(supabaseAdmin, input) {
  const existing = await findActiveRuntimeAutoReplace(
    supabaseAdmin,
    input.userId,
    input.sessionId,
  );
  if (existing) {
    return { operation: existing, created: false, deduped: true };
  }

  const correlationId =
    input.correlationId || `rar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const payload = {
    userId: input.userId,
    sessionId: input.sessionId,
    oldMachineId: input.oldMachineId,
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
    userId: input.userId,
    idempotencyKey: runtimeAutoReplaceIdempotencyKey(input.userId, input.sessionId),
    correlationId,
    priority: PRIORITY_CLASS.RECOVER,
    machineId: input.oldMachineId,
    gpuSessionId: input.sessionId,
    provider: input.provider ?? null,
    payload,
    retryPolicy: 'runtime_auto_replace',
  });

  if (result.skipped) {
    console.warn(
      '[enqueue-runtime-auto-replace] skipped — apply migration 0051 (p1-runtime-auto-replace-op.sql)',
    );
  }

  return { ...result, deduped: !result.created };
}
