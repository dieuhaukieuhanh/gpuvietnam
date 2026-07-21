import { isRetryableGpuError, mapProviderError } from './gpu-errors.js';
import {
  bootstrapProviderRegistry,
  createDefaultLegacyGpuProvider,
  createLegacyGpuProviderBridge,
  getDefaultProviderId,
  getProviderAdapter,
  tryGetProviderAdapter,
} from './provider-abstraction/index.js';

const DEFAULT_RETRIES = 2;
const RETRY_DELAY_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @typedef {import('./providers/gpu-provider.interface').GPUProvider} GPUProvider */
/** @typedef {import('./providers/gpu-provider.interface').CreateInstanceParams} CreateInstanceParams */
/** @typedef {import('./providers/gpu-provider.interface').SubmitWorkflowParams} SubmitWorkflowParams */
/** @typedef {import('./providers/gpu-provider.interface').UploadWorkflowParams} UploadWorkflowParams */
/** @typedef {import('./domain/gpu-instance').GPUInstance} GPUInstance */
/** @typedef {import('./domain/gpu-job').GPUJob} GPUJob */
/** @typedef {import('./domain/gpu-job').GPUOutput} GPUOutput */
/** @typedef {import('./domain/gpu-provider-info').GPUProviderInfo} GPUProviderInfo */
/** @typedef {import('./domain/gpu-status').GPUStatus} GPUStatus */

/**
 * Facade for GPU operations — the only entry point for backend code.
 */
export class GPUService {
  /**
   * @param {GPUProvider} provider
   */
  constructor(provider) {
    this.provider = provider;
  }

  /** @returns {GPUProviderInfo} */
  getProviderInfo() {
    return this.provider.getInfo();
  }

  /**
   * @param {string} operation
   * @param {Record<string, unknown>} [context]
   */
  log(operation, context = {}) {
    console.info('[GPUService]', operation, {
      provider: this.provider.getInfo().id,
      ...context,
    });
  }

  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @param {string} operation
   * @param {{ retries?: number; delayMs?: number }} [options]
   * @returns {Promise<T>}
   */
  async withRetry(fn, operation, options = {}) {
    const maxRetries = Number.isFinite(options.retries) ? Number(options.retries) : DEFAULT_RETRIES;
    const baseDelayMs = Number.isFinite(options.delayMs) ? Number(options.delayMs) : RETRY_DELAY_MS;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        if (attempt > 0) {
          this.log(`${operation}:retry`, { attempt: attempt + 1 });
        }
        return await fn();
      } catch (error) {
        lastError = mapProviderError(error, operation);
        const canRetry = attempt < maxRetries && isRetryableGpuError(lastError);
        if (!canRetry) {
          this.log(`${operation}:failed`, { message: lastError.message, attempt: attempt + 1 });
          throw lastError;
        }
        await sleep(baseDelayMs * (attempt + 1));
      }
    }

    throw lastError;
  }

  /** @param {CreateInstanceParams} params */
  async createInstance(params) {
    this.log('createInstance', { gpuLine: params.gpuLine, region: params.region });
    return this.withRetry(() => this.provider.createInstance(params), 'createInstance');
  }

  /** @param {string} instanceId */
  async destroyInstance(instanceId) {
    this.log('destroyInstance', { instanceId });
    // One short network retry only — Clore cancel_order already retries 429 with
    // multi-second backoff; stacking long service retries would stall stop UX.
    return this.withRetry(() => this.provider.destroyInstance(instanceId), 'destroyInstance', {
      retries: 1,
      delayMs: 800,
    });
  }

  /** @param {string} instanceId */
  async getInstanceStatus(instanceId) {
    this.log('getInstanceStatus', { instanceId });
    return this.withRetry(() => this.provider.getInstanceStatus(instanceId), 'getInstanceStatus');
  }

  /** @param {string} instanceId @param {SubmitWorkflowParams} params */
  async submitWorkflow(instanceId, params) {
    this.log('submitWorkflow', { instanceId });
    return this.withRetry(() => this.provider.submitWorkflow(instanceId, params), 'submitWorkflow');
  }

  /** @param {string} instanceId @param {string} jobId */
  async getJobStatus(instanceId, jobId) {
    this.log('getJobStatus', { instanceId, jobId });
    return this.withRetry(() => this.provider.getJobStatus(instanceId, jobId), 'getJobStatus');
  }

  /** @param {string} instanceId @param {string} jobId */
  async downloadOutputs(instanceId, jobId) {
    this.log('downloadOutputs', { instanceId, jobId });
    return this.withRetry(() => this.provider.downloadOutputs(instanceId, jobId), 'downloadOutputs');
  }

  /** @param {string} instanceId @param {UploadWorkflowParams} params */
  async uploadWorkflow(instanceId, params) {
    this.log('uploadWorkflow', { instanceId, filename: params.filename });
    return this.withRetry(() => this.provider.uploadWorkflow(instanceId, params), 'uploadWorkflow');
  }

  /** @param {string} instanceId */
  async healthCheck(instanceId) {
    this.log('healthCheck', { instanceId });
    return this.withRetry(() => this.provider.healthCheck(instanceId), 'healthCheck');
  }
}

/**
 * @param {GPUProvider} provider
 */
export function createGpuService(provider) {
  return new GPUService(provider);
}

/** @type {Map<string, GPUService>} */
const gpuServicesByProvider = new Map();

/**
 * GPUService for a specific marketplace provider (clore | vast | ...).
 * @param {string} [providerId]
 */
export function getGpuService(providerId) {
  const normalized = String(providerId ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'default') {
    const key = 'default';
    if (!gpuServicesByProvider.has(key)) {
      gpuServicesByProvider.set(key, createGpuService(createDefaultLegacyGpuProvider()));
    }
    return gpuServicesByProvider.get(key);
  }

  if (!gpuServicesByProvider.has(normalized)) {
    bootstrapProviderRegistry();
    const adapter = tryGetProviderAdapter(normalized) ?? getProviderAdapter(normalized);
    gpuServicesByProvider.set(
      normalized,
      createGpuService(createLegacyGpuProviderBridge(adapter)),
    );
  }
  return gpuServicesByProvider.get(normalized);
}

/**
 * Resolve GPUService from a machine row (`provider` / `provider_id`).
 * @param {{ provider?: string; provider_id?: string; providerId?: string } | null | undefined} machine
 */
export function getGpuServiceForMachine(machine) {
  const providerId =
    machine?.providerId ?? machine?.provider_id ?? machine?.provider ?? getDefaultProviderId();
  return getGpuService(String(providerId));
}
