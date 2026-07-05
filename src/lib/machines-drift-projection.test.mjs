/**
 * AF v2 regression — HTTP read path must not execute repairs or destroy pipeline.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '../..');

function readSrc(relativePath) {
  return readFileSync(path.join(root, 'src', relativePath), 'utf8');
}

function extractFunctionBody(source, functionName) {
  const sigRe = new RegExp(`export async function ${functionName}\\s*\\([^)]*\\)\\s*\\{`);
  const match = sigRe.exec(source);
  assert.ok(match, `${functionName} signature not found`);
  const braceStart = match.index + match[0].length - 1;

  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart, i + 1);
      }
    }
  }
  throw new Error(`unbalanced braces in ${functionName}`);
}

const READ_PATH_FORBIDDEN = [
  'executeDriftRepair',
  'destroyUserMachine',
  'runDestroyPipeline',
  'runProjectionVerificationPipeline',
  'resolveLiveMachineStatus',
  'syncMachineFromLiveStatus',
  'getGpuService',
  'getInstanceStatus',
  'detectSubscriptionMachineDrift(',
];

describe('AF v2 read path regression (machines-drift-projection)', () => {
  it('runReadPathProjectionFirst never executes repairs or provider destroy on HTTP', () => {
    const source = readSrc('lib/machines-drift-projection.js');
    const body = extractFunctionBody(source, 'runReadPathProjectionFirst');

    for (const token of READ_PATH_FORBIDDEN) {
      assert.ok(!body.includes(token), `runReadPathProjectionFirst must not reference ${token}`);
    }

    assert.ok(body.includes('detectSubscriptionMachineDriftProjectionOnly'));
    assert.ok(body.includes('enqueueSubscriptionMachineDriftRepair'));
    assert.ok(!body.includes('executeSubscriptionMachineDriftRepair'));
    assert.ok(body.includes('scheduleProjectionVerification'));
    assert.ok(body.includes("profStart('Load Machine')"));
    assert.ok(!body.includes('await import('));
  });

  it('scheduleProjectionVerification skips machine SELECT when caller passes machine', () => {
    const source = readSrc('lib/infrastructure/machine-operation-scheduler.js');
    const body = extractFunctionBody(source, 'scheduleProjectionVerification');
    assert.ok(body.includes("'machine' in options"));
    assert.ok(body.includes('findByIdempotencyKey'));
    assert.ok(body.includes('projectionVerifySkipReason'));
    assert.ok(body.includes('projection verify skipped'));
    assert.ok(body.includes('projection verify scheduled'));
    assert.ok(!body.includes('schedule projection verification'));
  });

  it('projection verification pipeline stamps projection_verified_at', () => {
    const source = readSrc('lib/infrastructure/projection-verification-pipeline.js');
    assert.ok(source.includes('projection_verified_at'));
    assert.ok(source.includes('projection_message'));
  });

  it('subscriptionPrefetchFromDashboardRow matches fetchActiveSubscription filter', () => {
    const projectionSource = readSrc('lib/machines-drift-projection.js');
    const dashboardSource = readSrc('pages/api/dashboard/me.js');
    assert.ok(projectionSource.includes('export function subscriptionPrefetchFromDashboardRow'));
    assert.ok(projectionSource.includes("['active', 'provisioning'].includes"));
    assert.ok(dashboardSource.includes('subscription: subscriptionPrefetchFromDashboardRow(subscription)'));
  });

  it('dashboard/me always uses runReadPathProjectionFirst (AF v2 default)', () => {
    const source = readSrc('pages/api/dashboard/me.js');
    assert.ok(source.includes('runReadPathProjectionFirst'));
    assert.ok(
      source.includes('await runReadPathProjectionFirst(supabaseAdmin, user.id'),
      'dashboard/me must call runReadPathProjectionFirst',
    );
    assert.ok(!source.includes('syncSubscriptionWithMachineState'));
    assert.ok(!source.includes('isScbReadProjectionFirst()'));
  });

  it('machines/status delegates to projection handler only', () => {
    const source = readSrc('pages/api/machines/status.js');
    assert.ok(source.includes('handleMachinesStatusProjectionFirst'));
    assert.ok(!source.includes('syncSubscriptionWithMachineState'));
    assert.ok(!source.includes('resolveLiveMachineStatus'));
    assert.ok(!source.includes('executeSubscriptionMachineDriftRepair'));
  });

  it('machines/status projection handler delegates to runReadPathProjectionFirst only', () => {
    const source = readSrc('lib/machines-status-projection.js');
    assert.ok(source.includes('runReadPathProjectionFirst'));
    for (const token of READ_PATH_FORBIDDEN) {
      assert.ok(!source.includes(token), `machines-status-projection must not reference ${token}`);
    }
  });

  it('machine-operation-worker persists drift repair via lifecycle SM', () => {
    const worker = readSrc('lib/infrastructure/machine-operation-worker.js');
    const drift = readSrc('lib/machines-drift.js');
    assert.ok(worker.includes('executeSubscriptionMachineDriftRepair'));
    assert.ok(drift.includes('persistDriftRepairLifecycle'));
    assert.ok(drift.includes('persistDriftRepair'));
    assert.ok(drift.includes('persistDestroyCompleted'));
  });
});
