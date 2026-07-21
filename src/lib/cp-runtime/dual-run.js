/**
 * Dual-run orchestrator — Job → Attempt A + Attempt B in parallel (B3.2).
 * Winner = first Attempt with durable Plane B outputs; loser cancelled.
 */

import { randomUUID } from 'node:crypto';
import { runJobAttemptViaRuntimePort } from './comfy-adapter.js';
import { RuntimePortError } from './runtime-port.js';
import { evaluateDualRunEligibility } from './dual-run-policy.js';

/**
 * Pure winner selection among finished branch results.
 *
 * @param {Array<{
 *   branch: string;
 *   attemptId: string;
 *   ok: boolean;
 *   finishedAtMs?: number;
 *   outputCount?: number;
 *   errorCode?: string | null;
 * }>} branches
 */
export function selectDualRunWinner(branches) {
  const list = Array.isArray(branches) ? branches : [];
  const successes = list
    .filter((b) => b.ok && (b.outputCount == null || Number(b.outputCount) > 0))
    .sort((a, b) => (a.finishedAtMs ?? Infinity) - (b.finishedAtMs ?? Infinity));

  if (successes.length === 0) {
    return {
      winner: null,
      losers: list,
      reason: 'all_failed',
    };
  }

  const winner = successes[0];
  const losers = list.filter((b) => b.attemptId !== winner.attemptId);
  return {
    winner,
    losers,
    reason: successes.length > 1 ? 'earliest_durable_success' : 'sole_success',
  };
}

/**
 * Run dual-run Job: two parallel Attempts; first durable success wins.
 *
 * @param {ReturnType<typeof import('./provider-runtime-bind.js').createProviderBackedComfyRuntimePort>} bundle
 * @param {{
 *   userId: string;
 *   jobId?: string;
 *   requiredImageSpecRef: string;
 *   workflowSnapshot: Record<string, unknown>;
 *   gpuLine?: string;
 *   planKey?: string | null;
 *   availableHostCount?: number | null;
 *   pollMs?: number;
 *   timeoutMs?: number;
 *   inputManifest?: object;
 *   attemptIds?: [string, string];
 *   forceDual?: boolean;
 * }} opts
 */
export async function runJobWithDualRun(bundle, opts) {
  const { port, registryStore } = bundle;
  const userId = String(opts.userId);
  const jobId = String(opts.jobId ?? randomUUID());
  const dualGroupId = randomUUID();

  const eligibility = evaluateDualRunEligibility({
    enabled: true,
    planKey: opts.planKey,
    availableHostCount: opts.availableHostCount,
  });

  if (!opts.forceDual && !eligibility.ok) {
    const { runJobWithFailover } = await import('./failover.js');
    const single = await runJobWithFailover(bundle, {
      userId: opts.userId,
      jobId,
      requiredImageSpecRef: opts.requiredImageSpecRef,
      workflowSnapshot: opts.workflowSnapshot,
      gpuLine: opts.gpuLine,
      pollMs: opts.pollMs,
      timeoutMs: opts.timeoutMs,
      inputManifest: opts.inputManifest,
      maxAttempts: 1,
    });
    return {
      mode: 'single_fallback',
      eligibility,
      dualGroupId: null,
      winner: {
        branch: 'A',
        attemptId: single.attemptId,
        attemptNumber: single.attemptNumber,
        runtimeId: single.runtimeId,
        outputManifest: single.outputManifest,
      },
      loser: null,
      jobId,
      userId,
      failoverUsed: single.failoverUsed,
      attempts: single.attempts,
      outputManifest: single.outputManifest,
    };
  }

  const attemptIdA = String(opts.attemptIds?.[0] ?? randomUUID());
  const attemptIdB = String(opts.attemptIds?.[1] ?? randomUUID());

  /** @type {{ winnerAttemptId: string | null }} */
  const race = { winnerAttemptId: null };

  /**
   * @param {'A' | 'B'} branch
   * @param {string} attemptId
   * @param {number} attemptNumber
   */
  async function runBranchWithAbort(branch, attemptId, attemptNumber) {
    await registryStore.upsertAttempt({
      attemptId,
      jobId,
      userId,
      attemptNumber,
      status: 'pending',
      metadata: { dual_run: true, branch, dualGroupId },
    });

    const startedAtMs = Date.now();

    try {
      const result = await runJobAttemptViaRuntimePort(port, {
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
          attemptNumber,
          dual_run: true,
          branch,
          dualGroupId,
        },
        shouldAbort: () =>
          race.winnerAttemptId != null && race.winnerAttemptId !== attemptId,
      });

      await registryStore.upsertAttempt({
        attemptId,
        jobId,
        userId,
        status: 'succeeded',
        runtimeId: result.runtimeId,
        externalPromptId: result.externalExecutionId,
      });

      const finishedAtMs = Date.now();
      const outputCount = Array.isArray(result.outputManifest?.outputs)
        ? result.outputManifest.outputs.length
        : 0;

      if (outputCount > 0 && race.winnerAttemptId == null) {
        race.winnerAttemptId = attemptId;
      }

      return {
        branch,
        attemptId,
        attemptNumber,
        ok: true,
        finishedAtMs,
        outputCount,
        result,
        durationMs: finishedAtMs - startedAtMs,
      };
    } catch (error) {
      const code = error instanceof RuntimePortError ? error.code : null;
      const cancelled = code === 'CANCELLED';
      await registryStore.upsertAttempt({
        attemptId,
        jobId,
        userId,
        status: cancelled ? 'cancelled' : 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        metadata: { dual_run: true, branch, dualGroupId, errorCode: code },
      });
      return {
        branch,
        attemptId,
        attemptNumber,
        ok: false,
        finishedAtMs: Date.now(),
        outputCount: 0,
        errorCode: code,
        error,
        durationMs: Date.now() - startedAtMs,
      };
    }
  }

  const settled = await Promise.all([
    runBranchWithAbort('A', attemptIdA, 1),
    runBranchWithAbort('B', attemptIdB, 2),
  ]);

  const selection = selectDualRunWinner(
    settled.map((s) => ({
      branch: s.branch,
      attemptId: s.attemptId,
      ok: s.ok,
      finishedAtMs: s.finishedAtMs,
      outputCount: s.outputCount,
      errorCode: s.errorCode ?? null,
    })),
  );

  if (!selection.winner) {
    throw new RuntimePortError(
      'EXECUTION_FAILED',
      `Dual-run Job ${jobId}: both Attempts failed`,
      { details: { dualGroupId, branches: settled.map((s) => ({
        branch: s.branch,
        attemptId: s.attemptId,
        ok: s.ok,
        errorCode: s.errorCode ?? null,
      })) } },
    );
  }

  const winnerFull = settled.find((s) => s.attemptId === selection.winner?.attemptId);
  const loserFull = settled.find((s) => s.attemptId !== selection.winner?.attemptId) ?? null;

  return {
    mode: 'dual_run',
    eligibility,
    dualGroupId,
    jobId,
    userId,
    winner: {
      branch: selection.winner.branch,
      attemptId: selection.winner.attemptId,
      attemptNumber: winnerFull?.attemptNumber ?? null,
      runtimeId: winnerFull?.result?.runtimeId ?? null,
      outputManifest: winnerFull?.result?.outputManifest ?? null,
      finishedAtMs: selection.winner.finishedAtMs,
    },
    loser: loserFull
      ? {
          branch: loserFull.branch,
          attemptId: loserFull.attemptId,
          attemptNumber: loserFull.attemptNumber,
          status: loserFull.ok
            ? 'superseded'
            : loserFull.errorCode === 'CANCELLED'
              ? 'cancelled'
              : 'failed',
          errorCode: loserFull.errorCode ?? null,
        }
      : null,
    selectionReason: selection.reason,
    attempts: settled.map((s) => ({
      branch: s.branch,
      attemptId: s.attemptId,
      attemptNumber: s.attemptNumber,
      ok: s.ok,
      outputCount: s.outputCount,
      errorCode: s.errorCode ?? null,
      durationMs: s.durationMs,
    })),
    outputManifest: winnerFull?.result?.outputManifest ?? null,
  };
}
