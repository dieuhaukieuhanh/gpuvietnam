import { GPUProviderError } from '../../gpu-errors.js';
import { ComfyClient, resolveComfyEndpoint } from './comfy-client.js';
import { VastClient } from './vast-client.js';
import {
  PROVIDER_ID,
  PROVIDER_NAME,
  mapComfyHealthToGPUStatus,
  mapComfyHistoryToGPUJob,
  mapComfyPromptToGPUJob,
  mapVastInstanceToGPUInstance,
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
    /** @type {Map<string, string>} */
    this.instanceEndpoints = new Map();
  }

  getInfo() {
    /** @type {GPUProviderInfo} */
    return {
      id: PROVIDER_ID,
      name: PROVIDER_NAME,
      version: '1.0.0',
    };
  }

  /** @param {CreateInstanceParams} params */
  async createInstance(params) {
    const raw = await this.client.createInstance(params);
    const instance = mapVastInstanceToGPUInstance(raw, params.gpuLine, { port: params.port });
    this.instanceGpuLines.set(instance.id, params.gpuLine);
    if (instance.endpointUrl) {
      this.instanceEndpoints.set(instance.id, instance.endpointUrl);
    }
    return instance;
  }

  /** @param {string} instanceId */
  async destroyInstance(instanceId) {
    await this.client.destroyInstance(instanceId);
    this.instanceGpuLines.delete(instanceId);
    this.instanceEndpoints.delete(instanceId);
  }

  /** @param {string} instanceId */
  async getInstanceStatus(instanceId) {
    const raw = await this.client.getInstance(instanceId);
    const gpuLine = this.instanceGpuLines.get(instanceId) ?? 'rtx4090_1x';
    const instance = mapVastInstanceToGPUInstance(raw, gpuLine, { instanceIdHint: instanceId });
    if (instance.endpointUrl) {
      this.instanceEndpoints.set(instanceId, instance.endpointUrl);
    }
    return instance;
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
    const comfy = await this.getComfyClient(instanceId);
    const payload = await comfy.healthCheck();
    return mapComfyHealthToGPUStatus(payload);
  }

  /**
   * @param {string} instanceId
   * @returns {Promise<ComfyClient>}
   */
  async getComfyClient(instanceId) {
    const cached = this.instanceEndpoints.get(instanceId);
    if (cached) {
      return new ComfyClient(cached);
    }

    const raw = await this.client.getInstance(instanceId);
    const endpoint = resolveComfyEndpoint(raw);
    if (!endpoint) {
      throw new GPUProviderError(`ComfyUI endpoint unavailable for instance ${instanceId}`, {
        retryable: true,
      });
    }

    this.instanceEndpoints.set(instanceId, endpoint);
    return new ComfyClient(endpoint);
  }
}
