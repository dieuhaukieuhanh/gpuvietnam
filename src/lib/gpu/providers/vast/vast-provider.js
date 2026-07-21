import { DEFAULT_GPU_PORT, resolveGpuImage } from '../../gpu-config.js';
import { GPUInstanceNotFoundError, GPUProviderError } from '../../gpu-errors.js';
import { ComfyClient } from './comfy-client.js';
import {
  createCachedEndpoint,
  invalidateEndpointCacheTrust,
  isEndpointCacheTrusted,
  markEndpointCacheHealthOk,
  resolveVastEndpoint,
  shouldRefreshEndpointCache,
} from './vast-endpoint-resolver.js';
import { VastClient } from './vast-client.js';
import {
  PROVIDER_ID,
  PROVIDER_NAME,
  mapComfyHealthToGPUStatus,
  mapComfyHistoryToGPUJob,
  mapComfyPromptToGPUJob,
  mapVastInstanceToGPUInstance,
  normalizeVastInstanceRecord,
} from './vast-mapper.js';

/** @typedef {import('../../providers/gpu-provider.interface').CreateInstanceParams} CreateInstanceParams */
/** @typedef {import('../../providers/gpu-provider.interface').SubmitWorkflowParams} SubmitWorkflowParams */
/** @typedef {import('../../providers/gpu-provider.interface').UploadWorkflowParams} UploadWorkflowParams */
/** @typedef {import('../../providers/gpu-provider.interface').GPUProvider} GPUProvider */
/** @typedef {import('../../domain/gpu-instance').GPUInstance} GPUInstance */
/** @typedef {import('../../domain/gpu-instance').GPULine} GPULine */
/** @typedef {import('../../domain/gpu-job').GPUJob} GPUJob */
/** @typedef {import('../../domain/gpu-job').GPUOutput} GPUOutput */
/** @typedef {import('../../domain/gpu-provider-info').GPUProviderInfo} GPUProviderInfo */
/** @typedef {import('../../domain/gpu-status').GPUStatus} GPUStatus */
/** @typedef {import('./vast-endpoint-resolver.js').CachedEndpoint} CachedEndpoint */
/** @typedef {import('./vast-endpoint-resolver.js').ResolvedEndpointPayload} ResolvedEndpointPayload */

/**
 * Vast.ai implementation of GPUProvider.
 * Parses Vast/Comfy responses and maps to internal domain models only.
 * @implements {GPUProvider}
 */
export class VastProvider {
  /**
   * @param {{ client?: VastClient }} [options]
   */
  constructor(options = {}) {
    this.client = options.client ?? new VastClient();
    /** @type {Map<string, GPULine>} */
    this.instanceGpuLines = new Map();
    /** @type {Map<string, CachedEndpoint>} */
    this.instanceEndpointCache = new Map();
    /** @type {Map<string, number>} */
    this.instanceInternalPorts = new Map();
  }

  getInfo() {
    /** @type {GPUProviderInfo} */
    return {
      id: PROVIDER_ID,
      name: PROVIDER_NAME,
      version: '1.0.0',
    };
  }

  /**
   * @param {string} instanceId
   * @param {number} [rentPort]
   */
  getInternalPort(instanceId, rentPort) {
    if (Number.isFinite(rentPort) && rentPort > 0) {
      return rentPort;
    }
    const cached = this.instanceInternalPorts.get(instanceId);
    if (Number.isFinite(cached) && cached > 0) {
      return cached;
    }
    const endpointCache = this.instanceEndpointCache.get(instanceId);
    if (endpointCache?.internalPort) {
      return endpointCache.internalPort;
    }
    return DEFAULT_GPU_PORT;
  }

  /**
   * @param {string} instanceId
   * @param {unknown} v0Payload
   * @param {number} internalPort
   * @returns {Promise<ResolvedEndpointPayload | null>}
   */
  async resolveAndCacheEndpoint(instanceId, v0Payload, internalPort) {
    const previous = this.instanceEndpointCache.get(instanceId);
    const result = await resolveVastEndpoint(this.client, instanceId, internalPort, v0Payload);

    if (result.status === 'pending') {
      return null;
    }

    const portChanged =
      previous != null && previous.externalPort !== result.endpoint.externalPort;
    const cached = createCachedEndpoint(result.endpoint);
    if (
      previous &&
      !portChanged &&
      previous.trusted &&
      previous.lastHealthOkAt != null &&
      isEndpointCacheTrusted(previous)
    ) {
      cached.trusted = previous.trusted;
      cached.lastHealthOkAt = previous.lastHealthOkAt;
    }

    this.instanceEndpointCache.set(instanceId, cached);
    this.instanceInternalPorts.set(instanceId, internalPort);
    return result.endpoint;
  }

  /**
   * @param {string} instanceId
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<CachedEndpoint>}
   */
  async ensureCachedEndpoint(instanceId, options = {}) {
    const cached = this.instanceEndpointCache.get(instanceId);
    const internalPort = this.getInternalPort(instanceId);

    if (cached && !shouldRefreshEndpointCache(cached, { force: options.force })) {
      return cached;
    }

    const resolved = await this.resolveAndCacheEndpoint(instanceId, undefined, internalPort);
    if (!resolved) {
      throw new GPUProviderError(`ComfyUI endpoint unavailable for instance ${instanceId}`, {
        retryable: true,
      });
    }

    const next = this.instanceEndpointCache.get(instanceId);
    if (!next) {
      throw new GPUProviderError(`ComfyUI endpoint unavailable for instance ${instanceId}`, {
        retryable: true,
      });
    }

    return next;
  }

  /** @param {CreateInstanceParams} params */
  async createInstance(params) {
    const internalPort = params.port ?? DEFAULT_GPU_PORT;
    const raw = await this.client.createInstance(params);
    const normalized = normalizeVastInstanceRecord(raw);
    const instanceId = String(
      normalized.id ?? normalized.instance_id ?? normalized.new_contract ?? '',
    );

    const resolved = instanceId
      ? await this.resolveAndCacheEndpoint(instanceId, raw, internalPort)
      : null;

    const instance = mapVastInstanceToGPUInstance(raw, params.gpuLine, {
      port: internalPort,
      resolvedEndpoint: resolved,
      image: params.image ?? resolveGpuImage(params.gpuLine),
    });
    this.instanceGpuLines.set(instance.id, params.gpuLine);
    this.instanceInternalPorts.set(instance.id, internalPort);
    return instance;
  }

  /** @param {string} instanceId */
  async destroyInstance(instanceId) {
    await this.client.destroyInstance(instanceId);
    this.instanceGpuLines.delete(instanceId);
    this.instanceEndpointCache.delete(instanceId);
    this.instanceInternalPorts.delete(instanceId);
  }

  /**
   * Find a rented instance by attempt label (orphan recovery).
   * @param {string} label
   * @param {GPULine} [gpuLine]
   * @returns {Promise<GPUInstance | null>}
   */
  async findInstanceByLabel(label, gpuLine = 'rtx4090_1x') {
    const rows = await this.client.listInstancesByLabel(label);
    if (!rows.length) return null;
    const first = rows[0];
    const id = String(first.id ?? first.instance_id ?? '');
    if (!id) return null;
    return mapVastInstanceToGPUInstance(first, gpuLine, { instanceIdHint: id });
  }

  /** @param {string} instanceId */
  async getInstanceStatus(instanceId) {
    const raw = await this.client.getInstance(instanceId);

    const instances = raw?.instances;
    const hasNestedInstance = Array.isArray(instances)
      ? instances.length > 0
      : Boolean(instances && typeof instances === 'object');
    if (
      !hasNestedInstance &&
      raw?.new_contract == null &&
      !raw?.actual_status &&
      raw?.id == null
    ) {
      throw new GPUInstanceNotFoundError(String(instanceId));
    }

    const internalPort = this.getInternalPort(instanceId);
    const resolved = await this.resolveAndCacheEndpoint(instanceId, raw, internalPort);

    const gpuLine = this.instanceGpuLines.get(instanceId) ?? 'rtx4090_1x';
    return mapVastInstanceToGPUInstance(raw, gpuLine, {
      instanceIdHint: instanceId,
      port: internalPort,
      resolvedEndpoint: resolved,
    });
  }

  /** @param {string} instanceId @param {SubmitWorkflowParams} params */
  async submitWorkflow(instanceId, params) {
    const comfy = await this.getComfyClient(instanceId);
    const response = await comfy.submitWorkflow(params);
    return mapComfyPromptToGPUJob(response, instanceId);
  }

  /** @param {string} instanceId @param {string} jobId */
  async getJobStatus(instanceId, jobId) {
    const comfy = await this.getComfyClient(instanceId);
    const history = await comfy.getHistory(jobId);
    const entry = history?.[jobId] ?? history;
    if (!entry) {
      return {
        id: jobId,
        instanceId,
        status: 'queued',
      };
    }
    return mapComfyHistoryToGPUJob(entry, instanceId, jobId);
  }

  /** @param {string} instanceId @param {string} jobId @returns {Promise<GPUOutput[]>} */
  async downloadOutputs(instanceId, jobId) {
    const comfy = await this.getComfyClient(instanceId);
    return comfy.listOutputs(jobId);
  }

  /** @param {string} instanceId @param {UploadWorkflowParams} params */
  async uploadWorkflow(instanceId, params) {
    const comfy = await this.getComfyClient(instanceId);
    await comfy.uploadWorkflow(params.filename, params.workflow);
  }

  /** @param {string} instanceId */
  async healthCheck(instanceId) {
    const cached = this.instanceEndpointCache.get(instanceId);
    let comfy;

    try {
      comfy = await this.getComfyClient(instanceId);
      const payload = await comfy.healthCheck();
      const status = mapComfyHealthToGPUStatus(payload);
      const activeCache = this.instanceEndpointCache.get(instanceId);
      if (activeCache && status.healthy) {
        markEndpointCacheHealthOk(activeCache);
      }
      return status;
    } catch (error) {
      if (cached) {
        invalidateEndpointCacheTrust(cached);
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/network|timeout|ECONN/i.test(message)) {
        await this.ensureCachedEndpoint(instanceId, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * @param {string} instanceId
   * @returns {Promise<ComfyClient>}
   */
  async getComfyClient(instanceId) {
    const cached = this.instanceEndpointCache.get(instanceId);
    if (cached && isEndpointCacheTrusted(cached)) {
      return new ComfyClient(cached.url);
    }

    const endpoint = await this.ensureCachedEndpoint(instanceId, {
      force: cached != null && !isEndpointCacheTrusted(cached),
    });
    return new ComfyClient(endpoint.url);
  }
}
