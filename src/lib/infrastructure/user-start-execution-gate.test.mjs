import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { canExecuteUserStartProvisionInThisProcess } from './user-start-execution-gate.js';

describe('user-start-execution-gate', () => {
  const prevWorker = process.env.GPUVIETNAM_LIFECYCLE_WORKER;
  const prevAllow = process.env.SCB_ALLOW_SERVERLESS_USER_START;

  afterEach(() => {
    if (prevWorker === undefined) delete process.env.GPUVIETNAM_LIFECYCLE_WORKER;
    else process.env.GPUVIETNAM_LIFECYCLE_WORKER = prevWorker;
    if (prevAllow === undefined) delete process.env.SCB_ALLOW_SERVERLESS_USER_START;
    else process.env.SCB_ALLOW_SERVERLESS_USER_START = prevAllow;
  });

  it('allows lifecycle worker', () => {
    delete process.env.SCB_ALLOW_SERVERLESS_USER_START;
    process.env.GPUVIETNAM_LIFECYCLE_WORKER = '1';
    assert.equal(canExecuteUserStartProvisionInThisProcess(), true);
  });

  it('blocks serverless by default (Vercel)', () => {
    delete process.env.GPUVIETNAM_LIFECYCLE_WORKER;
    delete process.env.SCB_ALLOW_SERVERLESS_USER_START;
    assert.equal(canExecuteUserStartProvisionInThisProcess(), false);
  });

  it('allows explicit serverless escape hatch', () => {
    delete process.env.GPUVIETNAM_LIFECYCLE_WORKER;
    process.env.SCB_ALLOW_SERVERLESS_USER_START = 'true';
    assert.equal(canExecuteUserStartProvisionInThisProcess(), true);
  });
});
