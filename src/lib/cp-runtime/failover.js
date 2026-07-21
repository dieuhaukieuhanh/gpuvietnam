/**
 * Job failover: Runtime death → Attempt FAIL → new Attempt on new GPU (B1.7).
 *
 * No CUDA / queue resume — full re-run via Runtime Port + Provider.
 * Spec: docs/architecture/B1_7_FAILOVER.md
 */

import { randomUUID } from 'node:crypto';
import { RuntimePortError } from './runtime-port.js';
import { runProviderBackedJobAttempt } from './provider-runtime-bind.js';

/** Error codes that warrant a new Attempt on a new Runtime (not resume). */
export const FAILOVER_RETRYABLE_CODES = Object.freeze([
  'EXECUTION_LOST',
  'EXECUTION_FAILED',
  'TIMEOUT',
  'UNAVAILABLE',
  'RUNTIME_NOT_READY',
  'DESTROY_FAILED',
  'FETCH_FAILED',
]);

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isFailoverRetryable(error) {
  if (!(error instanceof RuntimePortError)) return false;
  return FAILOVER_RETRYABLE_CODES.includes(error.code);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * @param {unknown} error
 * @returns {string | null}
 */
function errorCode(error) {
  if (error instanceof RuntimePortError) return error.code;
  return null;
}

/**
 * Run a Job with Attempt failover.
 *
 * Attempt N fails (lost/failed/…) → mark failed → destroy Runtime N →
 * Attempt N+1 on a **new** Provider instance with the same workflowSnapshot.
 *
 * @param {ReturnType<typeof import('./provider-runtime-bind.js').createProviderBackedComfyRuntimePort>} bundle
 * @param {{
 *   userId: string;
 *   jobId?: string;
 *   requiredImageSpecRef: string;
 *   workflowSnapshot: Record<string, unknown>;
 *   gpuLine?: string;
 *   maxAttempts?: number;
 *   pollMs?: number;
 *   timeoutMs?: number;
 *   inputManifest?: object;
 *   createMetadata?: Record<string, unknown>;
 *   attemptIds?: string[];
 * }} opts
 */
export async function runJobWithFailover(bundle, opts) {
  const { registryStore } = bundle;
  const userId = String(opts.userId);
  const jobId = String(opts.jobId ?? randomUUID());
  const maxAttempts = Math.max(1, Math.min(10, Number(opts.maxAttempts ?? 2) || 2));
  const attemptIds = Array.isArray(opts.attemptIds) ? opts.attemptIds : [];

  /** @type {Array<{
   *   attemptNumber: number;
   *   attemptId: string;
   *   runtimeId?: string | null;
   *   instanceId?: string | null;
   *   status: 'succeeded' | 'failed';
   *   errorCode?: string | null;
   *   errorMessage?: string | null;
   *   externalExecutionId?: string | null;
   * }>} */
  const attemptLog = [];

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    const attemptId =
      String(attemptIds[attemptNumber - 1] ?? '').trim() || randomUUID();

    await registryStore.upsertAttempt({
      attemptId,
      jobId,
      userId,
      attemptNumber,
      status: 'pending',
      metadata: { failover: attemptNumber > 1, maxAttempts },
    });

    try {
      const result = await runProviderBackedJobAttempt(bundle, {
        userId,
        jobId,
        attemptId,
        requiredImageSpecRef: opts.requiredImageSpecRef,
        workflowSnapshot: opts.workflowSnapshot,
        gpuLine: opts.gpuLine,
        pollMs: opts.pollMs,
        timeoutMs: opts.timeoutMs,
        inputManifest: opts.inputManifest,
        createMetadata: {
          ...(opts.createMetadata ?? {}),
          attemptNumber,
          failover: attemptNumber > 1,
        },
      });

      attemptLog.push({
        attemptNumber,
        attemptId,
        runtimeId: result.runtimeId,
        instanceId: result.runtime?.instanceId ?? null,
        status: 'succeeded',
        externalExecutionId: result.externalExecutionId,
      });

      return {
        jobId,
        userId,
        attemptNumber,
        attemptId,
        runtimeId: result.runtimeId,
        externalExecutionId: result.externalExecutionId,
        outputManifest: result.outputManifest,
        failoverUsed: attemptNumber > 1,
        attempts: attemptLog,
        attempt: result.attempt,
        runtime: result.runtime,
      };
    } catch (error) {
      const code = errorCode(error);
      const message = errorMessage(error);

      const existing = await registryStore.getAttempt(attemptId);
      await registryStore.upsertAttempt({
        attemptId,
        jobId,
        userId,
        attemptNumber,
        status: 'failed',
        runtimeId: existing?.runtimeId ?? null,
        instanceId: existing?.instanceId ?? null,
        errorMessage: message,
        metadata: {
          ...(existing?.metadata ?? {}),
          failoverRetryable: isFailoverRetryable(error),
          errorCode: code,
        },
      });

      attemptLog.push({
        attemptNumber,
        attemptId,
        runtimeId: existing?.runtimeId ?? null,
        instanceId: existing?.instanceId ?? null,
        status: 'failed',
        errorCode: code,
        errorMessage: message,
        externalExecutionId: existing?.externalPromptId ?? null,
      });

      const canRetry =
        attemptNumber < maxAttempts && isFailoverRetryable(error);

      if (!canRetry) {
        throw new RuntimePortError(
          code || 'EXECUTION_FAILED',
          `Job ${jobId} failed after ${attemptNumber} attempt(s): ${message}`,
          {
            retryable: false,
            cause: error,
            details: {
              jobId,
              attempts: attemptLog,
              failoverUsed: attemptNumber > 1,
            },
          },
        );
      }
      // Next loop: new Attempt id + new Provider instance (new Runtime). No resume.
    }
  }

  throw new RuntimePortError('EXECUTION_FAILED', `Job ${jobId} exhausted failover attempts`, {
    details: { jobId, attempts: attemptLog },
  });
}
