import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import {
  createComfyRuntimePort,
  runJobAttemptViaRuntimePort,
} from './comfy-adapter.js';
import { COMFY_SMOKE_WORKFLOW, TINY_PNG_BYTES } from './comfy-smoke-workflow.js';
import { SPEC_ID_V3 } from './runtime-image-spec.js';
import { RuntimePortError, assertRuntimePort } from './runtime-port.js';

/**
 * Minimal ComfyUI-compatible HTTP stub for Adapter smoke.
 * @returns {Promise<{ baseUrl: string; close: () => Promise<void>; prompts: Map<string, unknown> }>}
 */
function startFakeComfyServer() {
  /** @type {Map<string, unknown>} */
  const prompts = new Map();
  let seq = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/system_stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ system: { comfyui_version: 'fake' }, devices: [] }));
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
        const promptId = `fake-prompt-${seq}`;
        let parsed = {};
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          parsed = {};
        }
        prompts.set(promptId, parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ prompt_id: promptId, number: seq }));
      });
      return;
    }

    if (req.method === 'GET' && path.startsWith('/history/')) {
      const promptId = decodeURIComponent(path.slice('/history/'.length));
      if (!prompts.has(promptId)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({}));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          [promptId]: {
            outputs: {
              '2': {
                images: [{ filename: 'ComfyUI_smoke.png', type: 'output' }],
              },
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
    res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no address'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        prompts,
        close: () =>
          new Promise((resClose, rejClose) => {
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
  });
}

describe('cp-runtime comfy-adapter', () => {
  it('exposes a valid RuntimePort', () => {
    const port = createComfyRuntimePort();
    assertRuntimePort(port);
  });

  it('smoke: one Job Attempt end-to-end via Port only (fake Comfy)', async () => {
    const fake = await startFakeComfyServer();
    /** @type {Map<string, Buffer>} */
    const objects = new Map();

    try {
      const port = createComfyRuntimePort({
        putObject: async ({ key, body }) => {
          objects.set(key, Buffer.from(body));
          return key;
        },
      });

      // CP must not import ComfyClient — only Port.
      const result = await runJobAttemptViaRuntimePort(port, {
        userId: 'user_smoke_01',
        requiredImageSpecRef: SPEC_ID_V3,
        workflowSnapshot: { ...COMFY_SMOKE_WORKFLOW },
        createMetadata: {
          endpointUrl: fake.baseUrl,
          imageSpecRef: SPEC_ID_V3,
          attemptNumber: 1,
          provider: 'fake',
        },
        pollMs: 20,
        timeoutMs: 5000,
      });

      assert.ok(result.externalExecutionId.startsWith('fake-prompt-'));
      assert.equal(result.outputManifest.schema, 'cp.storage.manifest.v1');
      assert.equal(result.outputManifest.outputs.length, 1);
      const out = result.outputManifest.outputs[0];
      assert.match(out.r2_key, /\/cp\/jobs\/.+\/attempts\/1\/outputs\//);
      assert.ok(objects.has(out.r2_key));
      assert.equal(objects.get(out.r2_key)?.equals(TINY_PNG_BYTES), true);
      assert.equal(fake.prompts.size, 1);

      // destroy is idempotent
      const again = await port.destroy({ runtimeId: result.runtimeId });
      assert.equal(again.status, 'destroyed');
    } finally {
      await fake.close();
    }
  });

  it('create without endpoint fails clearly; parity mismatch fails', async () => {
    const port = createComfyRuntimePort();
    await assert.rejects(
      () =>
        port.create({
          userId: 'u',
          jobId: 'j',
          attemptId: 'a',
          requiredImageSpecRef: SPEC_ID_V3,
        }),
      (err) => err instanceof RuntimePortError && err.code === 'INVALID_ARGUMENT',
    );

    const fake = await startFakeComfyServer();
    try {
      await assert.rejects(
        () =>
          port.create({
            userId: 'u',
            jobId: 'j',
            attemptId: 'a',
            requiredImageSpecRef: 'gpuvietnam.comfy.v4@1.0',
            metadata: {
              endpointUrl: fake.baseUrl,
              imageSpecRef: SPEC_ID_V3,
            },
          }),
        (err) => err instanceof RuntimePortError && err.code === 'PARITY_FAILED',
      );
    } finally {
      await fake.close();
    }
  });
});
