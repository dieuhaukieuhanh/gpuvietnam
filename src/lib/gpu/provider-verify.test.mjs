import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GPUInstanceNotFoundError,
  GPUProviderError,
} from './gpu-errors.js';
import {
  NORMALIZED_PROVIDER_STATE,
  PROVIDER_VERIFY_ERROR_CODE,
  PROVIDER_VERIFY_OUTCOME,
  PROVIDER_VERIFY_STATE,
  buildProviderStateSnapshot,
  evaluateDestroyedVerify,
  evaluateRunningVerify,
  isVerifyPass,
  normalizeGpuStatusCode,
  reconcileMachine,
  reconcileSession,
  reconcileSettlement,
  verifyInstanceDestroyed,
  verifyInstanceRunning,
  verifyProviderState,
} from './provider-verify.js';

const NOW = '2026-07-03T12:00:00.000Z';

/** @param {string} code @param {{ healthy?: boolean, message?: string }} [options] */
function createGPUStatus(code, options = {}) {
  return {
    code,
    healthy: options.healthy ?? code === 'running',
    message: options.message,
    checkedAt: NOW,
  };
}

/** @param {Record<string, unknown>} handlers */
function mockPort(handlers) {
  return {
    getInstanceStatus: handlers.getInstanceStatus,
    healthCheck: handlers.healthCheck,
  };
}

/** @param {string} code @param {{ healthy?: boolean }} [options] */
function instanceWithStatus(code, options = {}) {
  return {
    id: 'inst-1',
    providerId: 'vast',
    providerName: 'Vast.ai',
    gpuLine: 'rtx4090_1x',
    status: createGPUStatus(code, { healthy: options.healthy ?? code === 'running' }),
  };
}

describe('normalizeGpuStatusCode', () => {
  it('maps running and stopped', () => {
    assert.equal(normalizeGpuStatusCode('running'), NORMALIZED_PROVIDER_STATE.RUNNING);
    assert.equal(normalizeGpuStatusCode('stopped'), NORMALIZED_PROVIDER_STATE.DESTROYED);
  });
});

describe('evaluateRunningVerify (pure)', () => {
  it('passes when running and healthy', () => {
    const snapshot = buildProviderStateSnapshot('i1', instanceWithStatus('running'), {
      health: createGPUStatus('running', { healthy: true }),
      checkedAt: NOW,
    });
    const result = evaluateRunningVerify(snapshot);
    assert.equal(result.state, PROVIDER_VERIFY_STATE.OK);
    assert.equal(result.outcome, PROVIDER_VERIFY_OUTCOME.VERIFIED_RUNNING);
  });

  it('fails when starting (T5)', () => {
    const snapshot = buildProviderStateSnapshot('i1', instanceWithStatus('starting'), {
      checkedAt: NOW,
    });
    const result = evaluateRunningVerify(snapshot);
    assert.equal(result.state, PROVIDER_VERIFY_STATE.FAILED);
    assert.equal(result.code, PROVIDER_VERIFY_ERROR_CODE.INSTANCE_NOT_READY);
  });

  it('fails when running without Comfy health (undefined)', () => {
    const snapshot = buildProviderStateSnapshot('i1', instanceWithStatus('running'), {
      checkedAt: NOW,
    });
    const result = evaluateRunningVerify(snapshot);
    assert.equal(result.state, PROVIDER_VERIFY_STATE.FAILED);
    assert.equal(result.code, PROVIDER_VERIFY_ERROR_CODE.INSTANCE_NOT_READY);
    assert.equal(result.retryable, true);
  });

  it('fails when running but health check unhealthy', () => {
    const snapshot = buildProviderStateSnapshot('i1', instanceWithStatus('running'), {
      health: createGPUStatus('running', { healthy: false }),
      checkedAt: NOW,
    });
    const result = evaluateRunningVerify(snapshot);
    assert.equal(result.state, PROVIDER_VERIFY_STATE.FAILED);
    assert.equal(result.code, PROVIDER_VERIFY_ERROR_CODE.HEALTH_CHECK_FAILED);
  });
});

describe('evaluateDestroyedVerify (pure)', () => {
  it('passes when destroyed normalized state', () => {
    const snapshot = {
      instanceId: 'i1',
      normalizedState: NORMALIZED_PROVIDER_STATE.DESTROYED,
      checkedAt: NOW,
    };
    const result = evaluateDestroyedVerify(snapshot);
    assert.equal(result.state, PROVIDER_VERIFY_STATE.OK);
    assert.equal(result.outcome, PROVIDER_VERIFY_OUTCOME.VERIFIED_DESTROYED);
  });

  it('fails when still running (T3)', () => {
    const snapshot = buildProviderStateSnapshot('i1', instanceWithStatus('running'), {
      checkedAt: NOW,
    });
    const result = evaluateDestroyedVerify(snapshot);
    assert.equal(result.state, PROVIDER_VERIFY_STATE.FAILED);
    assert.equal(result.code, PROVIDER_VERIFY_ERROR_CODE.INSTANCE_STILL_RUNNING);
  });
});

describe('verifyInstanceRunning', () => {
  it('T1 — provider returns running', async () => {
    const port = mockPort({
      async getInstanceStatus() {
        return instanceWithStatus('running');
      },
      async healthCheck() {
        return createGPUStatus('running', { healthy: true });
      },
    });
    const result = await verifyInstanceRunning('inst-1', port, { now: NOW });
    assert.equal(result.state, PROVIDER_VERIFY_STATE.OK);
    assert.ok(isVerifyPass(result, 'running'));
  });

  it('T5 — not ready stays failed', async () => {
    const port = mockPort({
      async getInstanceStatus() {
        return instanceWithStatus('starting');
      },
    });
    const result = await verifyInstanceRunning('inst-1', port, { now: NOW });
    assert.equal(result.state, PROVIDER_VERIFY_STATE.FAILED);
  });

  it('T4 — timeout returns unknown', async () => {
    const port = mockPort({
      async getInstanceStatus() {
        throw new GPUProviderError('ETIMEDOUT', { retryable: true });
      },
    });
    const result = await verifyInstanceRunning('inst-1', port, { now: NOW });
    assert.equal(result.state, PROVIDER_VERIFY_STATE.UNKNOWN);
    assert.equal(result.outcome, PROVIDER_VERIFY_OUTCOME.UNKNOWN);
  });

  it('is idempotent for same provider response', async () => {
    const port = mockPort({
      async getInstanceStatus() {
        return instanceWithStatus('running');
      },
      async healthCheck() {
        return createGPUStatus('running', { healthy: true });
      },
    });
    const a = await verifyInstanceRunning('inst-1', port, { now: NOW });
    const b = await verifyInstanceRunning('inst-1', port, { now: NOW });
    assert.equal(a.state, b.state);
    assert.equal(a.outcome, b.outcome);
  });
});

describe('verifyInstanceDestroyed', () => {
  it('T2 — provider 404 passes destroyed verify', async () => {
    const port = mockPort({
      async getInstanceStatus() {
        throw new GPUInstanceNotFoundError('inst-1');
      },
    });
    const result = await verifyInstanceDestroyed('inst-1', port, { now: NOW });
    assert.equal(result.state, PROVIDER_VERIFY_STATE.OK);
    assert.ok(isVerifyPass(result, 'destroyed'));
  });

  it('T3 — running when expect destroyed fails', async () => {
    const port = mockPort({
      async getInstanceStatus() {
        return instanceWithStatus('running');
      },
    });
    const result = await verifyInstanceDestroyed('inst-1', port, { now: NOW });
    assert.equal(result.state, PROVIDER_VERIFY_STATE.FAILED);
    assert.equal(result.code, PROVIDER_VERIFY_ERROR_CODE.INSTANCE_STILL_RUNNING);
  });

  it('T4 — API timeout returns unknown (no settlement path)', async () => {
    const port = mockPort({
      async getInstanceStatus() {
        throw new GPUProviderError('request timeout', { retryable: true });
      },
    });
    const result = await verifyInstanceDestroyed('inst-1', port, { now: NOW });
    assert.equal(result.state, PROVIDER_VERIFY_STATE.UNKNOWN);
    assert.equal(result.retryable, true);
  });

  it('passes on stopped instance', async () => {
    const port = mockPort({
      async getInstanceStatus() {
        return instanceWithStatus('stopped');
      },
    });
    const result = await verifyInstanceDestroyed('inst-1', port, { now: NOW });
    assert.ok(isVerifyPass(result, 'destroyed'));
  });
});

describe('verifyProviderState', () => {
  it('returns normalized snapshot without DB side effects', async () => {
    const port = mockPort({
      async getInstanceStatus() {
        return instanceWithStatus('running');
      },
      async healthCheck() {
        return createGPUStatus('running', { healthy: true });
      },
    });
    const result = await verifyProviderState('inst-1', port, { now: NOW });
    assert.equal(result.state, PROVIDER_VERIFY_STATE.OK);
    assert.equal(result.snapshot?.normalizedState, NORMALIZED_PROVIDER_STATE.RUNNING);
  });
});

describe('reconciliation contract (M13)', () => {
  it('reconcileMachine detects destroyed mismatch', () => {
    const result = reconcileMachine({
      machine: { id: 'm1', status: 'destroyed', instance_id: 'i1' },
      providerSnapshot: { normalizedState: 'running', instanceId: 'i1' },
    });
    assert.equal(result.drifts.length, 1);
    assert.equal(result.drifts[0].driftType, 'destroyed_mismatch');
  });

  it('reconcileSession detects orphan session', () => {
    const result = reconcileSession({
      session: { id: 's1', status: 'running' },
      machine: { id: 'm1', status: 'destroyed' },
    });
    assert.ok(result.drifts.some((d) => d.driftType === 'orphan_session'));
  });

  it('reconcileSettlement detects drift without settling', () => {
    const result = reconcileSettlement({
      session: { id: 's1', status: 'closed', settlement_status: 'failed' },
    });
    assert.equal(result.drifts.length, 1);
    assert.equal(result.message, 'drift detected');
  });
});

describe('invalid input', () => {
  it('rejects empty instanceId', async () => {
    const port = mockPort({
      async getInstanceStatus() {
        return instanceWithStatus('running');
      },
    });
    const result = await verifyInstanceRunning('', port);
    assert.equal(result.code, PROVIDER_VERIFY_ERROR_CODE.INVALID_INSTANCE_ID);
  });
});
