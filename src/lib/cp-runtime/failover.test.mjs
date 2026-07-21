import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import { COMFY_SMOKE_WORKFLOW, TINY_PNG_BYTES } from './comfy-smoke-workflow.js';
import {
  FAILOVER_RETRYABLE_CODES,
  isFailoverRetryable,
  runJobWithFailover,
} from './failover.js';
import { createProviderBackedComfyRuntimePort } from './provider-runtime-bind.js';
import { SPEC_ID_V3 } from './runtime-image-spec.js';
import { RuntimePortError } from './runtime-port.js';
import { createMemoryRuntimeRegistryStore } from './runtime-registry-store.js';

/**
 * @param {{ dieAfterPrompt?: boolean }} [options]
 */
function startFakeComfyServer(options = {}) {
  const dieAfterPrompt = Boolean(options.dieAfterPrompt);
  /** @type {Map<string, unknown>} */
  const prompts = new Map();
  let seq = 0;
  /** @type {http.Server} */
  let server;

  const handler = (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/system_stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ system: {}, devices: [] }));
      return;
    }
    if (req.method === 'GET' && path === '/queue') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ queue_running: [], queue_pending: [] }));
      return;
    }
    if (req.method === 'POST' && path === '/prompt') {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        seq += 1;
        const promptId = `fail-prompt-${seq}`;
        prompts.set(promptId, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ prompt_id: promptId }));
        if (dieAfterPrompt) {
          // Kill immediately after accepting the prompt (Runtime death mid-job).
          setImmediate(() => {
            try {
              server.close();
            } catch {
              /* ignore */
            }
          });
        }
      });
      return;
    }
    if (req.method === 'GET' && path.startsWith('/history/')) {
      // Dying runtime never finishes history (forces monitor → lost after process death).
      if (dieAfterPrompt) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({}));
        return;
      }
      const promptId = decodeURIComponent(path.slice('/history/'.length));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          [promptId]: {
            outputs: {
              '2': { images: [{ filename: 'ok.png', type: 'output' }] },
            },
            status: { status_str: 'success', completed: true },
          },
        }),
      );
      return;
    }
    if (req.method === 'GET' && path === '/view') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(TINY_PNG_BYTES);
      return;
    }
    res.writeHead(404);
    res.end('no');
  };

  return new Promise((resolve, reject) => {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no addr'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        prompts,
        close: () =>
          new Promise((resClose) => {
            server.close(() => resClose());
          }),
      });
    });
  });
}

/**
 * First rent → dying Comfy (A). Second rent → healthy Comfy (B).
 * @param {{ comfyA: string; comfyB: string }} urls
 */
function createFailoverFakeProvider(urls) {
  /** @type {Map<string, { id: string; endpointUrl: string; providerName: string }>} */
  const instances = new Map();
  /** @type {string[]} */
  const createdOrder = [];
  /** @type {string[]} */
  const destroyed = [];
  let n = 0;

  return {
    createdOrder,
    destroyed,
    instances,
    async createInstance() {
      n += 1;
      const id = `gpu-${n === 1 ? 'A' : 'B'}-${n}`;
      const endpointUrl = n === 1 ? urls.comfyA : urls.comfyB;
      createdOrder.push(id);
      instances.set(id, { id, endpointUrl, providerName: 'fake' });
      return {
        id,
        providerName: 'fake',
        providerId: 'fake',
        endpointUrl,
      };
    },
    async getInstanceStatus(instanceId) {
      const row = instances.get(instanceId);
      if (!row) throw new Error(`unknown ${instanceId}`);
      return { id: row.id, endpointUrl: row.endpointUrl, status: { healthy: true } };
    },
    async destroyInstance(instanceId) {
      destroyed.push(instanceId);
      instances.delete(instanceId);
    },
  };
}

describe('cp-runtime failover (B1.7)', () => {
  it('classifies retryable Port errors', () => {
    for (const code of FAILOVER_RETRYABLE_CODES) {
      assert.equal(isFailoverRetryable(new RuntimePortError(code, 'x')), true);
    }
    assert.equal(isFailoverRetryable(new RuntimePortError('PARITY_FAILED', 'x')), false);
    assert.equal(isFailoverRetryable(new RuntimePortError('SUBMIT_REJECTED', 'x')), false);
    assert.equal(isFailoverRetryable(new Error('nope')), false);
  });

  it('Runtime A dies → Attempt 1 failed → Attempt 2 on GPU B succeeds (re-run)', async () => {
    const comfyA = await startFakeComfyServer({ dieAfterPrompt: true });
    const comfyB = await startFakeComfyServer({ dieAfterPrompt: false });
    const provider = createFailoverFakeProvider({
      comfyA: comfyA.baseUrl,
      comfyB: comfyB.baseUrl,
    });
    const registryStore = createMemoryRuntimeRegistryStore();
    /** @type {Map<string, Buffer>} */
    const objects = new Map();

    try {
      const bundle = createProviderBackedComfyRuntimePort({
        provider,
        registryStore,
        waitTimeoutMs: 2000,
        pollMs: 20,
        putObject: async ({ key, body }) => {
          objects.set(key, Buffer.from(body));
          return key;
        },
      });

      const jobId = 'job_failover_01';
      const attempt1 = 'attempt_fail_01';
      const attempt2 = 'attempt_fail_02';

      const result = await runJobWithFailover(bundle, {
        userId: 'user_failover_01',
        jobId,
        requiredImageSpecRef: SPEC_ID_V3,
        gpuLine: 'rtx4090_1x',
        workflowSnapshot: { ...COMFY_SMOKE_WORKFLOW },
        maxAttempts: 2,
        pollMs: 30,
        timeoutMs: 4000,
        attemptIds: [attempt1, attempt2],
      });

      assert.equal(result.failoverUsed, true);
      assert.equal(result.attemptNumber, 2);
      assert.equal(result.attemptId, attempt2);
      assert.equal(result.attempts.length, 2);
      assert.equal(result.attempts[0].status, 'failed');
      assert.equal(result.attempts[0].attemptId, attempt1);
      assert.equal(result.attempts[0].errorCode, 'EXECUTION_LOST');
      assert.equal(result.attempts[1].status, 'succeeded');

      // Different GPUs — no resume of A
      assert.ok(provider.createdOrder[0].includes('A'));
      assert.ok(provider.createdOrder[1].includes('B'));
      assert.notEqual(result.attempts[0].instanceId, result.attempts[1].instanceId);
      assert.ok(provider.destroyed.includes(/** @type {string} */ (result.attempts[0].instanceId)));
      assert.ok(provider.destroyed.includes(/** @type {string} */ (result.runtime?.instanceId)));

      const a1 = await registryStore.getAttempt(attempt1);
      const a2 = await registryStore.getAttempt(attempt2);
      assert.equal(a1?.status, 'failed');
      assert.equal(a2?.status, 'succeeded');
      assert.notEqual(a1?.runtimeId, a2?.runtimeId);

      assert.equal(result.outputManifest.outputs.length, 1);
      assert.match(result.outputManifest.outputs[0].r2_key, /\/attempts\/2\/outputs\//);
      assert.ok(objects.has(result.outputManifest.outputs[0].r2_key));
    } finally {
      await comfyA.close().catch(() => {});
      await comfyB.close().catch(() => {});
    }
  });

  it('does not failover on PARITY_FAILED', async () => {
    const comfy = await startFakeComfyServer();
    const provider = createFailoverFakeProvider({
      comfyA: comfy.baseUrl,
      comfyB: comfy.baseUrl,
    });

    try {
      const bundle = createProviderBackedComfyRuntimePort({
        provider,
        registryStore: createMemoryRuntimeRegistryStore(),
        waitTimeoutMs: 2000,
        pollMs: 20,
        putObject: async ({ key }) => key,
      });

      await assert.rejects(
        () =>
          runJobWithFailover(bundle, {
            userId: 'u',
            jobId: 'job_parity',
            requiredImageSpecRef: 'gpuvietnam.comfy.v4@1.0',
            // Provider resolves v3 for rtx4090 → parity fail on create
            gpuLine: 'rtx4090_1x',
            workflowSnapshot: { ...COMFY_SMOKE_WORKFLOW },
            maxAttempts: 3,
            attemptIds: ['a1', 'a2', 'a3'],
          }),
        (err) => err instanceof RuntimePortError && err.code === 'PARITY_FAILED',
      );
      // Parity fails before rent — no Provider createInstance / no retry storm
      assert.equal(provider.createdOrder.length, 0);
    } finally {
      await comfy.close();
    }
  });
});
