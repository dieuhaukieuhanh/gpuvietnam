/**
 * P0-A — Enqueue durable user_start_provision (replaces void completeUserStartProvision).
 */

import {
  MACHINE_OPERATION,
  PRIORITY_CLASS,
  userStartProvisionIdempotencyKey,
} from './machine-operation-core.js';
import { enqueue } from './machine-operation-queue.js';

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
export async function enqueueUserStartProvision(supabaseAdmin, input) {
  const idempotencyKey = userStartProvisionIdempotencyKey(
    input.subscriptionId,
    input.correlationId,
  );

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

  return result;
}
