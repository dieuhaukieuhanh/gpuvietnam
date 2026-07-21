import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RUNTIME_PORT_METHODS,
  RuntimePortError,
  assertRuntimePort,
  createRecordingRuntimePort,
  createUnimplementedRuntimePort,
  validateCreateParams,
  validateSubmitParams,
} from './runtime-port.js';

describe('cp-runtime runtime-port', () => {
  it('unimplemented stub exposes all five methods and throws NOT_IMPLEMENTED', async () => {
    const port = createUnimplementedRuntimePort();
    assertRuntimePort(port);
    for (const method of RUNTIME_PORT_METHODS) {
      await assert.rejects(
        () => port[method](/** @type {any} */ ({})),
        (err) => err instanceof RuntimePortError && err.code === 'NOT_IMPLEMENTED',
      );
    }
  });

  it('assertRuntimePort rejects incomplete objects', () => {
    assert.throws(() => assertRuntimePort(null));
    assert.throws(() => assertRuntimePort({ create: async () => ({}) }));
  });

  it('recording port records calls and delegates handlers', async () => {
    const port = createRecordingRuntimePort({
      async create(params) {
        return {
          runtimeId: 'rt-1',
          imageSpecRef: params.requiredImageSpecRef,
          status: 'ready',
        };
      },
      async destroy(params) {
        return { runtimeId: params.runtimeId, status: 'destroyed' };
      },
    });

    const created = await port.create({
      userId: 'u1',
      attemptId: 'a1',
      jobId: 'j1',
      requiredImageSpecRef: 'gpuvietnam.comfy.v3@1.0',
    });
    assert.equal(created.runtimeId, 'rt-1');
    assert.equal(port.calls[0].method, 'create');

    const destroyed = await port.destroy({ runtimeId: 'rt-1' });
    assert.equal(destroyed.status, 'destroyed');
    assert.equal(port.calls.length, 2);

    await assert.rejects(
      () =>
        port.submit({
          runtimeId: 'rt-1',
          jobId: 'j1',
          attemptId: 'a1',
          workflowSnapshot: {},
          inputManifest: { schema: 'cp.storage.manifest.v1', inputs: [], outputs: [], model_refs: [] },
          imageSpecRef: 'gpuvietnam.comfy.v3@1.0',
        }),
      (err) => err instanceof RuntimePortError && err.code === 'NOT_IMPLEMENTED',
    );
  });

  it('validates create/submit params', () => {
    assert.throws(
      () => validateCreateParams(/** @type {any} */ ({})),
      (err) => err instanceof RuntimePortError && err.code === 'INVALID_ARGUMENT',
    );
    validateCreateParams({
      userId: 'u',
      attemptId: 'a',
      jobId: 'j',
      requiredImageSpecRef: 'gpuvietnam.comfy.v3@1.0',
    });

    assert.throws(
      () =>
        validateSubmitParams(
          /** @type {any} */ ({
            runtimeId: 'r',
            jobId: 'j',
            attemptId: 'a',
            imageSpecRef: 'gpuvietnam.comfy.v3@1.0',
          }),
        ),
      (err) => err instanceof RuntimePortError && err.code === 'INVALID_ARGUMENT',
    );
    validateSubmitParams({
      runtimeId: 'r',
      jobId: 'j',
      attemptId: 'a',
      imageSpecRef: 'gpuvietnam.comfy.v3@1.0',
      workflowSnapshot: { 1: { class_type: 'EmptyImage' } },
      inputManifest: {},
    });
  });
});
