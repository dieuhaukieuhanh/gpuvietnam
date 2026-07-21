/**
 * Bind GPU Provider Adapter → Runtime Port provision/destroy (B1.6).
 *
 * Invariant: one Attempt ↔ one Runtime ↔ one provider instance (GPU).
 */

import { randomUUID } from 'node:crypto';
import { resolveGpuImage } from '../gpu/gpu-config.js';
import { resolveImageSpecRefForGpuLine } from './runtime-image-spec.js';
import { RuntimePortError } from './runtime-port.js';
import {
  createComfyRuntimePort,
  runJobAttemptViaRuntimePort,
} from './comfy-adapter.js';
import { createMemoryRuntimeRegistryStore } from './runtime-registry-store.js';

/**
 * @typedef {object} GpuProviderLike
 * @property {(params: {
 *   gpuLine: string;
 *   image?: string;
 *   label?: string;
 *   region?: string;
 *   diskSize?: number;
 *   port?: number;
 *   env?: Record<string, string>;
 * }) => Promise<{
 *   id: string;
 *   providerName?: string;
 *   providerId?: string;
 *   gpuLine?: string;
 *   endpointUrl?: string | null;
 *   metadata?: Record<string, unknown>;
 * }>} createInstance
 * @property {(instanceId: string) => Promise<void>} destroyInstance
 * @property {(instanceId: string) => Promise<{
 *   id: string;
 *   endpointUrl?: string | null;
 *   status?: { healthy?: boolean };
 *   metadata?: Record<string, unknown>;
 * }>} getInstanceStatus
 */

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll provider until Comfy endpoint URL is available.
 *
 * @param {GpuProviderLike} provider
 * @param {string} instanceId
 * @param {{ timeoutMs?: number; pollMs?: number }} [options]
 */
export async function waitForProviderEndpoint(provider, instanceId, options = {}) {
  const timeoutMs = Math.max(100, Number(options.timeoutMs ?? 120_000));
  const pollMs = Math.max(10, Number(options.pollMs ?? 2_000));
  const deadline = Date.now() + timeoutMs;
  let last = null;

  while (Date.now() < deadline) {
    last = await provider.getInstanceStatus(instanceId);
    const url = String(last?.endpointUrl ?? '').trim();
    if (url) {
      return { instance: last, endpointUrl: url.replace(/\/$/, '') };
    }
    await sleep(pollMs);
  }

  throw new RuntimePortError(
    'RUNTIME_NOT_READY',
    `Provider instance ${instanceId} has no endpointUrl within ${timeoutMs}ms`,
    {
      retryable: true,
      details: { instanceId, lastStatus: last?.status ?? null },
    },
  );
}

/**
 * @param {{
 *   provider: GpuProviderLike;
 *   registryStore?: ReturnType<typeof createMemoryRuntimeRegistryStore>;
 *   resolveImage?: typeof resolveGpuImage;
 *   resolveImageSpecRef?: typeof resolveImageSpecRefForGpuLine;
 *   waitTimeoutMs?: number;
 *   pollMs?: number;
 *   idFactory?: () => string;
 *   defaultGpuLine?: string;
 * }} deps
 */
export function createProviderRuntimeBindings(deps) {
  if (!deps?.provider) {
    throw new RuntimePortError('INVALID_ARGUMENT', 'provider is required');
  }
  const provider = deps.provider;
  const registryStore = deps.registryStore ?? createMemoryRuntimeRegistryStore();
  const resolveImage = deps.resolveImage ?? resolveGpuImage;
  const resolveImageSpecRef = deps.resolveImageSpecRef ?? resolveImageSpecRefForGpuLine;
  const waitTimeoutMs = Number(deps.waitTimeoutMs ?? 120_000);
  const pollMs = Number(deps.pollMs ?? 2_000);
  const idFactory = deps.idFactory ?? (() => randomUUID());
  const defaultGpuLine = String(deps.defaultGpuLine ?? 'rtx4090_1x');

  /** @type {Map<string, { instanceId: string; providerName: string }>} */
  const computeByRuntime = new Map();

  /**
   * @param {import('./runtime-port.js').RuntimePortCreateParams} params
   */
  async function provisionRuntime(params) {
    const gpuLine = String(params.gpuLine ?? defaultGpuLine).trim() || defaultGpuLine;
    const image = resolveImage(gpuLine);
    const imageSpecRef = resolveImageSpecRef(gpuLine);
    const runtimeId = String(params.runtimeId ?? '').trim() || idFactory();
    const attemptNumber = Number(params.metadata?.attemptNumber ?? 1) || 1;

    await registryStore.upsertRuntime({
      id: runtimeId,
      userId: params.userId,
      provider: 'pending',
      status: 'provisioning',
      imageSpecRef,
      image,
      metadata: {
        jobId: params.jobId,
        attemptId: params.attemptId,
        gpuLine,
      },
    });

    await registryStore.upsertAttempt({
      attemptId: params.attemptId,
      jobId: params.jobId,
      userId: params.userId,
      attemptNumber,
      status: 'provisioning',
      runtimeId,
      imageSpecRef,
    });

    let instance;
    try {
      instance = await provider.createInstance({
        gpuLine,
        image,
        label: `cp-a-${String(params.attemptId).replace(/-/g, '').slice(0, 24)}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await registryStore.upsertRuntime({
        id: runtimeId,
        status: 'error',
        lastError: message,
      });
      await registryStore.upsertAttempt({
        attemptId: params.attemptId,
        jobId: params.jobId,
        userId: params.userId,
        status: 'failed',
        errorMessage: message,
      });
      throw new RuntimePortError('UNAVAILABLE', `Provider createInstance failed: ${message}`, {
        retryable: true,
        cause: error,
      });
    }

    const instanceId = String(instance.id ?? '').trim();
    if (!instanceId) {
      throw new RuntimePortError('UNAVAILABLE', 'Provider createInstance returned no id');
    }

    const providerName = String(
      instance.providerName ?? instance.providerId ?? 'unknown',
    );

    await registryStore.upsertRuntime({
      id: runtimeId,
      provider: providerName,
      instanceId,
      status: 'starting',
    });

    let endpointUrl;
    try {
      const ready = await waitForProviderEndpoint(provider, instanceId, {
        timeoutMs: waitTimeoutMs,
        pollMs,
      });
      endpointUrl = ready.endpointUrl;
    } catch (error) {
      try {
        await provider.destroyInstance(instanceId);
      } catch {
        /* best-effort orphan cleanup */
      }
      const message = error instanceof Error ? error.message : String(error);
      await registryStore.upsertRuntime({
        id: runtimeId,
        status: 'error',
        lastError: message,
        instanceId,
      });
      await registryStore.upsertAttempt({
        attemptId: params.attemptId,
        jobId: params.jobId,
        userId: params.userId,
        status: 'failed',
        errorMessage: message,
      });
      throw error instanceof RuntimePortError
        ? error
        : new RuntimePortError('RUNTIME_NOT_READY', message, { cause: error });
    }

    computeByRuntime.set(runtimeId, { instanceId, providerName });

    await registryStore.upsertRuntime({
      id: runtimeId,
      userId: params.userId,
      provider: providerName,
      instanceId,
      endpointUrl,
      imageSpecRef,
      image,
      status: 'ready',
    });

    await registryStore.upsertAttempt({
      attemptId: params.attemptId,
      jobId: params.jobId,
      userId: params.userId,
      attemptNumber,
      status: 'submitting',
      runtimeId,
      instanceId,
      imageSpecRef,
    });

    return {
      runtimeId,
      endpointUrl,
      instanceId,
      machineId: null,
      provider: providerName,
      imageSpecRef,
      status: /** @type {const} */ ('ready'),
    };
  }

  /**
   * @param {import('./comfy-adapter.js').ComfyAdapterRuntimeRecord} runtime
   * @param {import('./runtime-port.js').RuntimePortDestroyParams} _params
   */
  async function releaseCompute(runtime, _params) {
    const runtimeId = runtime.runtimeId;
    const linked = computeByRuntime.get(runtimeId);
    const instanceId = String(
      linked?.instanceId ?? runtime.instanceId ?? '',
    ).trim();

    await registryStore.upsertRuntime({
      id: runtimeId,
      status: 'stopping',
    });

    if (instanceId) {
      try {
        await provider.destroyInstance(instanceId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await registryStore.upsertRuntime({
          id: runtimeId,
          status: 'error',
          lastError: message,
        });
        throw new RuntimePortError('DESTROY_FAILED', message, {
          retryable: true,
          cause: error,
        });
      }
    }

    computeByRuntime.delete(runtimeId);
    await registryStore.upsertRuntime({
      id: runtimeId,
      status: 'destroyed',
      instanceId: instanceId || null,
    });

    const attempt = await registryStore.getAttemptByRuntime(runtimeId);
    if (attempt && !['succeeded', 'failed', 'cancelled'].includes(attempt.status)) {
      await registryStore.upsertAttempt({
        attemptId: attempt.attemptId,
        jobId: attempt.jobId,
        userId: attempt.userId,
        status: attempt.status === 'running' ? 'cancelled' : attempt.status,
      });
    }
  }

  return {
    registryStore,
    provisionRuntime,
    releaseCompute,
    computeByRuntime,
  };
}

/**
 * Comfy RuntimePort with Provider-backed create/destroy + registry updates.
 *
 * @param {{
 *   provider: GpuProviderLike;
 *   registryStore?: ReturnType<typeof createMemoryRuntimeRegistryStore>;
 *   putObject?: (args: { key: string; body: Buffer | Uint8Array; contentType?: string }) => Promise<string>;
 *   waitTimeoutMs?: number;
 *   pollMs?: number;
 *   defaultGpuLine?: string;
 *   createComfyClient?: (endpointUrl: string) => import('../gpu/providers/vast/comfy-client.js').ComfyClient;
 * }} deps
 */
export function createProviderBackedComfyRuntimePort(deps) {
  const bindings = createProviderRuntimeBindings({
    provider: deps.provider,
    registryStore: deps.registryStore,
    waitTimeoutMs: deps.waitTimeoutMs,
    pollMs: deps.pollMs,
    defaultGpuLine: deps.defaultGpuLine,
  });

  const port = createComfyRuntimePort({
    createComfyClient: deps.createComfyClient,
    putObject: deps.putObject,
    provisionRuntime: bindings.provisionRuntime,
    releaseCompute: bindings.releaseCompute,
    async onRuntimeReady(runtime) {
      await bindings.registryStore.upsertRuntime({
        id: runtime.runtimeId,
        userId: runtime.userId,
        status: 'ready',
        endpointUrl: runtime.endpointUrl,
        imageSpecRef: runtime.imageSpecRef,
        provider: runtime.provider ?? 'unknown',
        instanceId: runtime.instanceId,
        machineId: runtime.machineId,
      });
      await bindings.registryStore.upsertAttempt({
        attemptId: runtime.attemptId,
        jobId: runtime.jobId,
        userId: runtime.userId,
        status: 'submitting',
        runtimeId: runtime.runtimeId,
        instanceId: runtime.instanceId,
        imageSpecRef: runtime.imageSpecRef,
      });
    },
    async onAttemptSubmitted({ runtime, externalExecutionId, jobId, attemptId }) {
      await bindings.registryStore.upsertRuntime({
        id: runtime.runtimeId,
        status: 'busy',
      });
      await bindings.registryStore.upsertAttempt({
        attemptId,
        jobId,
        userId: runtime.userId,
        status: 'running',
        runtimeId: runtime.runtimeId,
        externalPromptId: externalExecutionId,
        instanceId: runtime.instanceId,
        imageSpecRef: runtime.imageSpecRef,
      });
    },
  });

  return {
    port,
    registryStore: bindings.registryStore,
    bindings,
  };
}

/**
 * Provision (via Provider) → submit → monitor → fetch → destroy, updating Attempt to running/succeeded.
 *
 * @param {ReturnType<typeof createProviderBackedComfyRuntimePort>} bundle
 * @param {Parameters<typeof runJobAttemptViaRuntimePort>[1]} opts
 */
export async function runProviderBackedJobAttempt(bundle, opts) {
  const { port, registryStore } = bundle;

  try {
    const result = await runJobAttemptViaRuntimePort(port, {
      ...opts,
      // Provider supplies endpoint — do not require metadata.endpointUrl
      createMetadata: {
        ...(opts.createMetadata ?? {}),
        attemptNumber: opts.createMetadata?.attemptNumber ?? 1,
      },
    });

    await registryStore.upsertAttempt({
      attemptId: result.attemptId,
      jobId: result.jobId,
      userId: opts.userId,
      status: 'succeeded',
      runtimeId: result.runtimeId,
      externalPromptId: result.externalExecutionId,
    });

    const runtime = await registryStore.getRuntime(result.runtimeId);
    return { ...result, attempt: await registryStore.getAttempt(result.attemptId), runtime };
  } catch (error) {
    const attemptId = String(opts.attemptId ?? '');
    if (attemptId) {
      const prev = await registryStore.getAttempt(attemptId);
      if (prev && prev.status === 'running') {
        await registryStore.upsertAttempt({
          attemptId,
          jobId: prev.jobId,
          userId: prev.userId,
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
    throw error;
  }
}
