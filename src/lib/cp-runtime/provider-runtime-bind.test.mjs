import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import { COMFY_SMOKE_WORKFLOW, TINY_PNG_BYTES } from './comfy-smoke-workflow.js';
import {
  createProviderBackedComfyRuntimePort,
  runProviderBackedJobAttempt,
  waitForProviderEndpoint,
} from './provider-runtime-bind.js';
import { SPEC_ID_V3 } from './runtime-image-spec.js';
import { createMemoryRuntimeRegistryStore } from './runtime-registry-store.js';

function startFakeComfyServer() {
  /** @type {Map<string, unknown>} */
  const prompts = new Map();
  let seq = 0;
  const server = http.createServer((req, res) => {
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
        const promptId = `prov-prompt-${seq}`;
        prompts.set(promptId, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ prompt_id: promptId }));
      });
      return;
    }
    if (req.method === 'GET' && path.startsWith('/history/')) {
      const promptId = decodeURIComponent(path.slice('/history/'.length));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          [promptId]: {
            outputs: {
              '2': { images: [{ filename: 'out.png', type: 'output' }] },
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
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no addr'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((resClose, rejClose) => {
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
  });
}

/**
 * @param {string} comfyBaseUrl
 */
function createFakeGpuProvider(comfyBaseUrl) {
  /** @type {Map<string, { id: string; endpointUrl: string | null; providerName: string }>} */
  const instances = new Map();
  let n = 0;
  /** @type {string[]} */
  const destroyed = [];

  return {
    destroyed,
    instances,
    async createInstance(params) {
      n += 1;
      const id = `fake-inst-${n}`;
      // Simulate brief delay before endpoint is published.
      instances.set(id, {
        id,
        endpointUrl: null,
        providerName: 'fake',
        gpuLine: params.gpuLine,
      });
      setTimeout(() => {
        const row = instances.get(id);
        if (row) row.endpointUrl = comfyBaseUrl;
      }, 30);
      return {
        id,
        providerName: 'fake',
        providerId: 'fake',
        gpuLine: params.gpuLine,
        endpointUrl: null,
      };
    },
    async getInstanceStatus(instanceId) {
      const row = instances.get(instanceId);
      if (!row) throw new Error(`unknown instance ${instanceId}`);
      return {
        id: row.id,
        endpointUrl: row.endpointUrl,
        status: { healthy: Boolean(row.endpointUrl) },
      };
    },
    async destroyInstance(instanceId) {
      destroyed.push(instanceId);
      instances.delete(instanceId);
    },
  };
}

describe('cp-runtime provider-runtime-bind (B1.6)', () => {
  it('waitForProviderEndpoint polls until URL appears', async () => {
    const provider = createFakeGpuProvider('http://127.0.0.1:9');
    const created = await provider.createInstance({ gpuLine: 'rtx4090_1x' });
    const ready = await waitForProviderEndpoint(provider, created.id, {
      timeoutMs: 2000,
      pollMs: 20,
    });
    assert.equal(ready.endpointUrl, 'http://127.0.0.1:9');
  });

  it('provision → registry → submit → Attempt running → one GPU destroyed', async () => {
    const fakeComfy = await startFakeComfyServer();
    const provider = createFakeGpuProvider(fakeComfy.baseUrl);
    const registryStore = createMemoryRuntimeRegistryStore();
    /** @type {Map<string, Buffer>} */
    const objects = new Map();

    try {
      const bundle = createProviderBackedComfyRuntimePort({
        provider,
        registryStore,
        waitTimeoutMs: 3000,
        pollMs: 20,
        defaultGpuLine: 'rtx4090_1x',
        putObject: async ({ key, body }) => {
          objects.set(key, Buffer.from(body));
          return key;
        },
      });

      const jobId = 'job_b16_01';
      const attemptId = 'attempt_b16_01';

      const result = await runProviderBackedJobAttempt(bundle, {
        userId: 'user_b16_01',
        jobId,
        attemptId,
        requiredImageSpecRef: SPEC_ID_V3,
        gpuLine: 'rtx4090_1x',
        workflowSnapshot: { ...COMFY_SMOKE_WORKFLOW },
        pollMs: 20,
        timeoutMs: 5000,
      });

      assert.equal(result.attempt?.status, 'succeeded');
      assert.equal(result.attempt?.runtimeId, result.runtimeId);
      assert.ok(result.attempt?.externalPromptId);
      assert.equal(result.runtime?.status, 'destroyed');
      assert.equal(result.runtime?.provider, 'fake');
      assert.ok(result.runtime?.instanceId);
      assert.equal(provider.destroyed.length, 1);
      assert.equal(provider.destroyed[0], result.runtime?.instanceId);
      assert.equal(provider.instances.size, 0);
      assert.equal(result.outputManifest.outputs.length, 1);
      assert.ok(objects.has(result.outputManifest.outputs[0].r2_key));

      // One Attempt = one Runtime = one GPU instance
      const attemptsLinked = await registryStore.getAttemptByRuntime(result.runtimeId);
      assert.equal(attemptsLinked?.attemptId, attemptId);
    } finally {
      await fakeComfy.close();
    }
  });
});
