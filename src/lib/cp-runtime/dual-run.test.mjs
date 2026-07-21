import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import { COMFY_SMOKE_WORKFLOW, TINY_PNG_BYTES } from './comfy-smoke-workflow.js';
import {
  DUAL_RUN_BILLING,
  buildDualRunUxState,
  estimateDualRunCustomerCharge,
  evaluateDualRunEligibility,
  isDualRunAllowedForPlan,
} from './dual-run-policy.js';
import { runJobWithDualRun, selectDualRunWinner } from './dual-run.js';
import { createProviderBackedComfyRuntimePort } from './provider-runtime-bind.js';
import { SPEC_ID_V3 } from './runtime-image-spec.js';
import { createMemoryRuntimeRegistryStore } from './runtime-registry-store.js';

/**
 * @param {{ delayHistoryMs?: number; dieAfterPrompt?: boolean }} [options]
 */
function startFakeComfyServer(options = {}) {
  const delayHistoryMs = Number(options.delayHistoryMs ?? 0);
  const dieAfterPrompt = Boolean(options.dieAfterPrompt);
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
        const promptId = `dual-${seq}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ prompt_id: promptId }));
        if (dieAfterPrompt) {
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
      if (dieAfterPrompt) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({}));
        return;
      }
      const promptId = decodeURIComponent(path.slice('/history/'.length));
      const respond = () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            [promptId]: {
              outputs: {
                '2': { images: [{ filename: 'win.png', type: 'output' }] },
              },
              status: { status_str: 'success', completed: true },
            },
          }),
        );
      };
      if (delayHistoryMs > 0) setTimeout(respond, delayHistoryMs);
      else respond();
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
        close: () =>
          new Promise((resClose) => {
            server.close(() => resClose());
          }),
      });
    });
  });
}

/**
 * Alternating endpoints: 1st rent → A, 2nd → B.
 * @param {{ urlA: string; urlB: string }} urls
 */
function createDualFakeProvider(urls) {
  /** @type {Map<string, { id: string; endpointUrl: string }>} */
  const instances = new Map();
  /** @type {string[]} */
  const created = [];
  /** @type {string[]} */
  const destroyed = [];
  let n = 0;

  return {
    created,
    destroyed,
    async createInstance() {
      n += 1;
      const id = `dual-gpu-${n === 1 ? 'A' : 'B'}`;
      const endpointUrl = n === 1 ? urls.urlA : urls.urlB;
      created.push(id);
      instances.set(id, { id, endpointUrl });
      return { id, providerName: 'fake', endpointUrl };
    },
    async getInstanceStatus(instanceId) {
      const row = instances.get(instanceId);
      if (!row) throw new Error('missing');
      return { id: row.id, endpointUrl: row.endpointUrl, status: { healthy: true } };
    },
    async destroyInstance(instanceId) {
      destroyed.push(instanceId);
      instances.delete(instanceId);
    },
  };
}

describe('cp-runtime dual-run policy (B3.1 / B3.3)', () => {
  it('gates plans and estimates capped charge', () => {
    assert.equal(isDualRunAllowedForPlan('pro'), true);
    assert.equal(isDualRunAllowedForPlan('starter'), false);
    assert.equal(evaluateDualRunEligibility({ enabled: true, planKey: 'studio' }).ok, true);
    assert.equal(
      evaluateDualRunEligibility({ enabled: true, planKey: 'pro', availableHostCount: 1 }).ok,
      false,
    );

    const charge = estimateDualRunCustomerCharge({
      winnerMinutes: 60,
      loserMinutes: 50,
      singleRatePerMinute: 100,
    });
    assert.ok(charge.cappedCharge <= 60 * 100 * DUAL_RUN_BILLING.hardCapMultiplier);
    assert.ok(charge.effectiveMultiplier <= DUAL_RUN_BILLING.hardCapMultiplier);

    const ux = buildDualRunUxState({ planKey: 'pro', enabled: true, availableHostCount: 3 });
    assert.equal(ux.canEnable, true);
    assert.match(ux.costWarning, /1\.9/);
  });

  it('selectDualRunWinner picks earliest durable success', () => {
    const sel = selectDualRunWinner([
      { branch: 'A', attemptId: 'a', ok: true, finishedAtMs: 200, outputCount: 1 },
      { branch: 'B', attemptId: 'b', ok: true, finishedAtMs: 100, outputCount: 1 },
    ]);
    assert.equal(sel.winner?.attemptId, 'b');
    assert.equal(sel.reason, 'earliest_durable_success');
  });
});

describe('cp-runtime dual-run orchestrator (B3.2)', () => {
  it('B wins when A is slow; loser cancelled or superseded', async () => {
    const comfyA = await startFakeComfyServer({ delayHistoryMs: 400 });
    const comfyB = await startFakeComfyServer({ delayHistoryMs: 20 });
    const provider = createDualFakeProvider({
      urlA: comfyA.baseUrl,
      urlB: comfyB.baseUrl,
    });

    try {
      const bundle = createProviderBackedComfyRuntimePort({
        provider,
        registryStore: createMemoryRuntimeRegistryStore(),
        waitTimeoutMs: 2000,
        pollMs: 15,
        putObject: async ({ key }) => key,
      });

      const result = await runJobWithDualRun(bundle, {
        userId: 'user_dual_01',
        jobId: 'job_dual_01',
        requiredImageSpecRef: SPEC_ID_V3,
        gpuLine: 'rtx4090_1x',
        planKey: 'pro',
        availableHostCount: 5,
        forceDual: true,
        workflowSnapshot: { ...COMFY_SMOKE_WORKFLOW },
        pollMs: 20,
        timeoutMs: 5000,
        attemptIds: ['attempt_A', 'attempt_B'],
      });

      assert.equal(result.mode, 'dual_run');
      assert.equal(result.winner.branch, 'B');
      assert.equal(result.winner.attemptId, 'attempt_B');
      assert.ok(result.outputManifest?.outputs?.length >= 1);
      assert.ok(result.loser);
      assert.ok(['cancelled', 'superseded', 'failed'].includes(String(result.loser?.status)));
      assert.equal(provider.created.length, 2);
    } finally {
      await comfyA.close().catch(() => {});
      await comfyB.close().catch(() => {});
    }
  });

  it('falls back to single when not eligible', async () => {
    const comfy = await startFakeComfyServer();
    const provider = createDualFakeProvider({
      urlA: comfy.baseUrl,
      urlB: comfy.baseUrl,
    });
    try {
      const bundle = createProviderBackedComfyRuntimePort({
        provider,
        registryStore: createMemoryRuntimeRegistryStore(),
        waitTimeoutMs: 2000,
        pollMs: 15,
        putObject: async ({ key }) => key,
      });

      const result = await runJobWithDualRun(bundle, {
        userId: 'u',
        requiredImageSpecRef: SPEC_ID_V3,
        workflowSnapshot: { ...COMFY_SMOKE_WORKFLOW },
        planKey: 'starter',
        availableHostCount: 5,
        pollMs: 20,
        timeoutMs: 4000,
      });
      assert.equal(result.mode, 'single_fallback');
      assert.equal(provider.created.length, 1);
    } finally {
      await comfy.close();
    }
  });
});
