import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  MACHINE_OPERATION,
  buildDriftIdempotencyKey,
  detectResultFromOperationPayload,
  hasExhaustedAttempts,
  isMachineOperationsTableUnavailable,
  priorityForOperation,
  projectionVerifyIdempotencyKey,
  projectionVerifySkipReason,
  repairKindToOperation,
  resolveRetryAfterFailure,
  userStartProvisionIdempotencyKey,
} from './machine-operation-core.js';
import { buildOperationMetrics } from './machine-operation-metrics.js';
import { resolveAdminStateFilter } from './machine-operation-admin.js';

describe('machine-operation-core (SCB 2.1 Phase 2)', () => {
  it('maps drift repair kinds to queue operations', () => {
    assert.equal(repairKindToOperation('update_subscription'), MACHINE_OPERATION.DRIFT_UPDATE_SUBSCRIPTION);
    assert.equal(
      repairKindToOperation('destroy_and_subscription_offline'),
      MACHINE_OPERATION.DRIFT_DESTROY_AND_SUBSCRIPTION_OFFLINE,
    );
    assert.equal(repairKindToOperation('unknown'), null);
  });

  it('buildDriftIdempotencyKey is stable for same drift', () => {
    const repair = { kind: 'destroy_user_machine', machine: { id: 'm-1' } };
    const a = buildDriftIdempotencyKey('user-1', 'destroyed_leaked_machine', repair);
    const b = buildDriftIdempotencyKey('user-1', 'destroyed_leaked_machine', repair);
    assert.equal(a, b);
    assert.match(a, /^drift:user-1:destroyed_leaked_machine:m-1:destroy_user_machine$/);
  });

  it('destroy operations have higher priority than subscription updates', () => {
    assert.ok(
      priorityForOperation(MACHINE_OPERATION.DRIFT_DESTROY_USER_MACHINE) >
        priorityForOperation(MACHINE_OPERATION.DRIFT_UPDATE_SUBSCRIPTION),
    );
  });

  it('projectionVerifySkipReason distinguishes pending vs running', () => {
    assert.equal(projectionVerifySkipReason(null), null);
    assert.equal(projectionVerifySkipReason({ state: 'pending' }), 'already_pending');
    assert.equal(projectionVerifySkipReason({ state: 'retry_scheduled' }), 'already_pending');
    assert.equal(projectionVerifySkipReason({ state: 'running' }), 'already_running');
    assert.equal(projectionVerifySkipReason({ state: 'leased' }), 'already_running');
    assert.equal(projectionVerifySkipReason({ state: 'completed' }), null);
  });

  it('projectionVerifyIdempotencyKey is stable per user and machine', () => {
    assert.equal(
      projectionVerifyIdempotencyKey('user-1', 'machine-1'),
      'projection_verify:user-1:machine-1',
    );
    assert.equal(
      projectionVerifyIdempotencyKey('user-1', null),
      'projection_verify:user-1:none',
    );
  });

  it('userStartProvisionIdempotencyKey is stable per subscription+correlation', () => {
    assert.equal(
      userStartProvisionIdempotencyKey('sub-1', 'corr-1'),
      'user_start_provision:sub-1:corr-1',
    );
  });

  it('user_start_provision has higher priority than projection_verify', () => {
    assert.ok(
      priorityForOperation(MACHINE_OPERATION.USER_START_PROVISION) >
        priorityForOperation(MACHINE_OPERATION.PROJECTION_VERIFY),
    );
  });

  it('hasExhaustedAttempts delegates to retry policy', () => {
    assert.equal(hasExhaustedAttempts(4, 'default_drift'), false);
    assert.equal(hasExhaustedAttempts(5, 'default_drift'), true);
  });

  it('resolveRetryAfterFailure re-exported from policies', () => {
    const result = resolveRetryAfterFailure('default_drift', 2);
    assert.equal(result.deadLetter, false);
    assert.equal(result.delayMs, 20_000);
  });

  it('detectResultFromOperationPayload reconstructs drift detect payload', () => {
    const row = {
      payload: {
        action: 'reset_orphan_online',
        repair: {
          kind: 'update_subscription',
          subscriptionId: 'sub-1',
          serverStatus: 'offline',
        },
        machine: null,
        subscription: { id: 'sub-1', server_status: 'offline' },
        correlationId: 'corr-1',
      },
    };

    const detect = detectResultFromOperationPayload(row);
    assert.equal(detect.action, 'reset_orphan_online');
    assert.equal(detect.repair?.kind, 'update_subscription');
    assert.equal(detect.subscription?.server_status, 'offline');
    assert.equal(detect.machine, null);
  });

  it('isMachineOperationsTableUnavailable detects PostgREST schema cache errors', () => {
    assert.equal(
      isMachineOperationsTableUnavailable({
        code: 'PGRST205',
        message: "Could not find the table 'public.machine_operations' in the schema cache",
      }),
      true,
    );
    assert.equal(
      isMachineOperationsTableUnavailable({
        code: '23514',
        message:
          'new row for relation "machine_operations" violates check constraint "machine_operations_operation_check"',
      }),
      true,
    );
    assert.equal(
      isMachineOperationsTableUnavailable({ code: '23505', message: 'duplicate key' }),
      false,
    );
  });
});

describe('machine-operation-metrics (Phase 2.5)', () => {
  it('buildOperationMetrics includes required keys', () => {
    const metrics = buildOperationMetrics(
      {
        created_at: '2026-07-05T10:00:00.000Z',
        started_at: '2026-07-05T10:00:02.000Z',
        attempts: 2,
        lease_count: 1,
        state: 'completed',
      },
      { executionMs: 500, now: new Date('2026-07-05T10:00:02.500Z') },
    );

    assert.equal(metrics.queue_wait_ms, 2000);
    assert.equal(metrics.execution_ms, 500);
    assert.equal(metrics.retry_count, 2);
    assert.equal(metrics.lease_count, 1);
    assert.equal(metrics.success_rate, 1);
    assert.equal(metrics.failure_rate, 0);
  });
});

describe('machine-operation-admin (Phase 2.5)', () => {
  it('resolveAdminStateFilter maps views to states', () => {
    assert.deepEqual(resolveAdminStateFilter('running'), ['leased', 'running']);
    assert.deepEqual(resolveAdminStateFilter('dead_letter'), ['dead_letter']);
    assert.equal(resolveAdminStateFilter('all'), null);
  });
});

describe('machine-operation-worker-runner wiring', () => {
  const infraDir = dirname(fileURLToPath(import.meta.url));

  it('kicks worker after enqueue and starts background worker on boot', () => {
    const runnerSource = readFileSync(join(infraDir, 'machine-operation-worker-runner.js'), 'utf8');
    const queueSource = readFileSync(join(infraDir, 'machine-operation-queue.js'), 'utf8');
    const schedulerSource = readFileSync(join(infraDir, 'machine-operation-scheduler.js'), 'utf8');
    const instrumentationSource = readFileSync(join(infraDir, '../../instrumentation.js'), 'utf8');
    const statusProjectionSource = readFileSync(join(infraDir, '../machines-status-projection.js'), 'utf8');

    assert.match(runnerSource, /export function kickMachineOperationWorker/);
    assert.match(runnerSource, /export function kickMachineOperationWorkerForRow/);
    assert.match(runnerSource, /export function startMachineOperationBackgroundWorker/);
    assert.match(runnerSource, /processMachineOperationBatch/);
    assert.match(queueSource, /kickMachineOperationWorkerForRow/);
    assert.match(schedulerSource, /schedule_already_pending/);
    assert.match(instrumentationSource, /startMachineOperationBackgroundWorker/);
    assert.doesNotMatch(statusProjectionSource, /nudgeBootProjectionVerification/);
  });
});
