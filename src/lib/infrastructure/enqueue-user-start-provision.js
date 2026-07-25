/**
 * P0-A — Enqueue durable user_start_provision (replaces void completeUserStartProvision).
 * At most one active provision op per user (open idempotency slot).
 */

import {
  MACHINE_OPERATION,
  MACHINE_OPERATION_STATE,
  PRIORITY_CLASS,
  isActiveQueueState,
  isTerminalQueueState,
  userStartProvisionIdempotencyKey,
  userStartProvisionReleasedIdempotencyKey,
} from './machine-operation-core.js';
import { cancel, enqueue, findByIdempotencyKey } from './machine-operation-queue.js';

const ACTIVE_OP_STATES = [
  MACHINE_OPERATION_STATE.PENDING,
  MACHINE_OPERATION_STATE.LEASED,
  MACHINE_OPERATION_STATE.RUNNING,
  MACHINE_OPERATION_STATE.RETRY_SCHEDULED,
];

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function findActiveUserStartProvision(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .select('*')
    .eq('user_id', userId)
    .eq('operation', MACHINE_OPERATION.USER_START_PROVISION)
    .in('state', ACTIVE_OP_STATES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (data && isActiveQueueState(data)) return data;
  return null;
}

/**
 * Cancel in-flight start provisions so cancel-start frees the open slot
 * (including RUNNING — queue.cancel alone only covers pending/leased).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {string} [reason]
 */
export async function cancelActiveUserStartProvisions(
  supabaseAdmin,
  userId,
  reason = 'user_cancel_start',
) {
  const { data: rows, error } = await supabaseAdmin
    .from('machine_operations')
    .select('id,state,user_id,operation')
    .eq('user_id', userId)
    .eq('operation', MACHINE_OPERATION.USER_START_PROVISION)
    .in('state', ACTIVE_OP_STATES);

  if (error) throw error;
  const list = Array.isArray(rows) ? rows : [];
  /** @type {string[]} */
  const cancelledIds = [];

  for (const row of list) {
    const id = String(row.id);
    const soft = await cancel(supabaseAdmin, id, reason);
    if (soft) {
      cancelledIds.push(id);
      continue;
    }
    // Force-terminal RUNNING / raced rows + release open idempotency slot.
    const { data: forced, error: forceErr } = await supabaseAdmin
      .from('machine_operations')
      .update({
        state: MACHINE_OPERATION_STATE.CANCELLED,
        finished_at: new Date().toISOString(),
        lease_until: null,
        next_retry_at: null,
        last_error: reason,
        idempotency_key: userStartProvisionReleasedIdempotencyKey(userId, id),
      })
      .eq('id', id)
      .in('state', ACTIVE_OP_STATES)
      .select('id')
      .maybeSingle();
    if (forceErr) throw forceErr;
    if (forced?.id) cancelledIds.push(String(forced.id));
  }

  return { cancelledIds, count: cancelledIds.length };
}

/**
 * @typedef {Object} UserStartProvisionEnqueueInput
 * @property {string} userId
 * @property {string} subscriptionId
 * @property {string} correlationId
 * @property {Record<string, unknown>} selected
 * @property {string} planKey
 * @property {string} planName
 * @property {string} gpuLine
 * @property {string} envName
 * @property {Record<string, string>|null|undefined} workstationContainerEnv
 * @property {string|null|undefined} backupTokenId
 * @property {Record<string, unknown>|null|undefined} lifecycleCtx
 * @property {string} provisionLabel
 * @property {string|null|undefined} [provider]
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {UserStartProvisionEnqueueInput} input
 */
/**
 * Ops / force-cancel sometimes leave a terminal row still holding the open
 * slot key — Start then "succeeds" as dedupe without renting a GPU.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function releaseStuckOpenUserStartSlot(supabaseAdmin, userId) {
  const openKey = userStartProvisionIdempotencyKey(userId);
  const stuck = await findByIdempotencyKey(supabaseAdmin, openKey);
  if (!stuck || !isUserStartProvisionLike(stuck) || !isTerminalQueueState(stuck)) {
    return { released: false, operationId: null };
  }
  const id = String(stuck.id);
  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .update({
      idempotency_key: userStartProvisionReleasedIdempotencyKey(userId, id),
      last_error:
        stuck.last_error != null && String(stuck.last_error).trim()
          ? String(stuck.last_error)
          : 'released_stuck_open_start_slot',
    })
    .eq('id', id)
    .eq('idempotency_key', openKey)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return { released: Boolean(data?.id), operationId: data?.id ? String(data.id) : null };
}

function isUserStartProvisionLike(row) {
  return String(row?.operation ?? '') === MACHINE_OPERATION.USER_START_PROVISION;
}

export async function enqueueUserStartProvision(supabaseAdmin, input) {
  const existing = await findActiveUserStartProvision(supabaseAdmin, input.userId);
  if (existing) {
    return { operation: existing, created: false, deduped: true };
  }

  // Free open slot if a cancelled/failed start still owns the unique key.
  await releaseStuckOpenUserStartSlot(supabaseAdmin, input.userId);

  const idempotencyKey = userStartProvisionIdempotencyKey(input.userId);

  const payload = {
    userId: input.userId,
    subscriptionId: input.subscriptionId,
    selected: input.selected,
    planKey: input.planKey,
    planName: input.planName,
    gpuLine: input.gpuLine,
    envName: input.envName,
    workstationContainerEnv: input.workstationContainerEnv ?? null,
    backupTokenId: input.backupTokenId ?? null,
    lifecycleCtx: input.lifecycleCtx ?? null,
    correlationId: input.correlationId,
    provisionLabel: input.provisionLabel,
  };

  const result = await enqueue(supabaseAdmin, {
    operation: MACHINE_OPERATION.USER_START_PROVISION,
    userId: input.userId,
    idempotencyKey,
    correlationId: input.correlationId,
    priority: PRIORITY_CLASS.PROVISION,
    machineId: null,
    gpuSessionId: null,
    provider: input.provider ?? null,
    payload,
    retryPolicy: 'user_start_provision',
  });

  if (result.skipped) {
    throw new Error(
      'machine_operations unavailable — apply migration 0049 (p0a-user-start-provision-op.sql) before start-machine',
    );
  }

  // Deduped against a terminal row should never happen after release — treat as error signal.
  if (
    !result.created &&
    result.operation &&
    isTerminalQueueState(result.operation) &&
    isUserStartProvisionLike(result.operation)
  ) {
    await releaseStuckOpenUserStartSlot(supabaseAdmin, input.userId);
    const retry = await enqueue(supabaseAdmin, {
      operation: MACHINE_OPERATION.USER_START_PROVISION,
      userId: input.userId,
      idempotencyKey,
      correlationId: input.correlationId,
      priority: PRIORITY_CLASS.PROVISION,
      machineId: null,
      gpuSessionId: null,
      provider: input.provider ?? null,
      payload,
      retryPolicy: 'user_start_provision',
    });
    if (retry.skipped) {
      throw new Error(
        'machine_operations unavailable — apply migration 0049 (p0a-user-start-provision-op.sql) before start-machine',
      );
    }
    return { ...retry, deduped: !retry.created };
  }

  return { ...result, deduped: !result.created };
}
