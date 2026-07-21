import { DEFAULT_GPU_PORT, resolveGpuImage } from '../../gpu-config.js';
import { GPUInstanceNotFoundError, GPUProviderError } from '../../gpu-errors.js';
import { ComfyClient } from '../vast/comfy-client.js';
import {
  mapComfyHealthToGPUStatus,
  mapComfyHistoryToGPUJob,
  mapComfyPromptToGPUJob,
} from '../vast/vast-mapper.js';
import { CloreClient } from './clore-client.js';
import {
  PROVIDER_ID,
  PROVIDER_NAME,
  mapCloreOrderToGPUInstance,
  normalizeCloreOrderRecord,
  resolveClorePublicEndpoints,
} from './clore-mapper.js';

/** @typedef {import('../../providers/gpu-provider.interface').CreateInstanceParams} CreateInstanceParams */
/** @typedef {import('../../providers/gpu-provider.interface').SubmitWorkflowParams} SubmitWorkflowParams */
/** @typedef {import('../../providers/gpu-provider.interface').UploadWorkflowParams} UploadWorkflowParams */
/** @typedef {import('../../domain/gpu-instance').GPUInstance} GPUInstance */
/** @typedef {import('../../domain/gpu-instance').GPULine} GPULine */
/** @typedef {import('../../domain/gpu-job').GPUJob} GPUJob */

/**
 * Clore.ai implementation of GPUProvider with ComfyUI integration.
 */
export class CloreProvider {
  /**
   * @param {{ client?: CloreClient }} [options]
   */
  constructor(options = {}) {
    this.client = options.client ?? new CloreClient();
    /** @type {Map<string, GPULine>} */
    this.instanceGpuLines = new Map();
    /** @type {Map<string, number>} */
    this.instanceInternalPorts = new Map();
    /** @type {Map<string, string>} */
    this.instanceEndpointCache = new Map();
  }

  getInfo() {
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
    return DEFAULT_GPU_PORT;
  }

  /**
   * Resolve ComfyUI endpoint URL from a Clore order.
   * @param {string} instanceId
   * @param {Record<string, unknown>} [orderRecord]
   * @returns {Promise<string | null>}
   */
  async resolveComfyEndpoint(instanceId, orderRecord) {
    // Try cached first
    const cached = this.instanceEndpointCache.get(instanceId);
    if (cached && orderRecord == null) {
      return cached;
    }

    let endpointUrl = null;

    if (orderRecord) {
      const endpoints = resolveClorePublicEndpoints(
        /** @type {Record<string, unknown>} */ (orderRecord),
        this.getInternalPort(instanceId),
      );
      endpointUrl = endpoints.endpointUrl ?? null;

      if (!endpointUrl) {
        const connection =
          orderRecord.connection && typeof orderRecord.connection === 'object'
            ? /** @type {Record<string, unknown>} */ (orderRecord.connection)
            : {};
        const ssh = String(connection.ssh ?? '');
        const sshMatch = ssh.match(/ssh\s+\S+@([\w.-]+)\s+-p\s+(\d+)/i);
        if (sshMatch && sshMatch[1]) {
          endpointUrl = 'http://' + sshMatch[1] + ':' + this.getInternalPort(instanceId);
        }
      }
    }

    if (endpointUrl) {
      this.instanceEndpointCache.set(instanceId, endpointUrl);
      return endpointUrl;
    }

    return cached ?? null;
  }

  /**
   * Get or resolve ComfyClient for an instance.
   * @param {string} instanceId
   * @returns {Promise<ComfyClient>}
   */
  async getComfyClient(instanceId) {
    let endpointUrl = this.instanceEndpointCache.get(instanceId);

    if (!endpointUrl) {
      // Try to resolve from live order
      try {
        const raw = await this.getOrderInternal(instanceId);
        endpointUrl = await this.resolveComfyEndpoint(instanceId, raw);
      } catch {
        // If we can't get the order, use cached if available
        endpointUrl = this.instanceEndpointCache.get(instanceId);
      }
    }

    if (!endpointUrl) {
      throw new GPUProviderError(
        'ComfyUI endpoint not available for Clore instance ' + instanceId +
        '. The machine may still be booting or the port is not yet exposed.',
        { retryable: true },
      );
    }

    return new ComfyClient(endpointUrl);
  }

  /**
   * Get raw order data (internal helper, does not throw on not-found).
   * @param {string} instanceId
   * @returns {Promise<Record<string, unknown> | null>}
   */
  async getOrderInternal(instanceId) {
    try {
      return await this.client.getOrder(instanceId);
    } catch {
      return null;
    }
  }

  /** @param {CreateInstanceParams} params */
  async createInstance(params) {
    const internalPort = params.port ?? DEFAULT_GPU_PORT;
    const raw = await this.client.createInstance(params);
    const normalized = normalizeCloreOrderRecord(raw);
    const instanceId = String(normalized.order_id ?? normalized.id ?? '');

    const instance = mapCloreOrderToGPUInstance(raw, params.gpuLine, {
      port: internalPort,
      selection:
        raw && typeof raw === 'object'
          ? /** @type {Record<string, unknown>} */ (raw).gpuvietnam_selection
          : null,
      image: params.image ?? resolveGpuImage(params.gpuLine),
    });

    if (instanceId) {
      this.instanceGpuLines.set(instanceId, params.gpuLine);
      this.instanceInternalPorts.set(instanceId, internalPort);

      // Try to resolve ComfyUI endpoint eagerly
      await this.resolveComfyEndpoint(instanceId, raw).catch(() => {
        // Endpoint may not be ready yet - that's OK, will resolve on demand
      });
    }
    return instance;
  }

  /** @param {string} instanceId */
  async destroyInstance(instanceId) {
    await this.client.destroyInstance(instanceId);
    this.instanceGpuLines.delete(instanceId);
    this.instanceInternalPorts.delete(instanceId);
    this.instanceEndpointCache.delete(instanceId);
  }

  /** @param {string} instanceId */
  async getInstanceStatus(instanceId) {
    const raw = await this.client.getOrder(instanceId);
    const gpuLine = this.instanceGpuLines.get(instanceId) ?? 'rtx4090_1x';
    const port = this.instanceInternalPorts.get(instanceId) ?? DEFAULT_GPU_PORT;

    // Refresh endpoint cache on each status poll
    this.resolveComfyEndpoint(instanceId, raw).catch(() => {
      // Non-critical — endpoint may not be ready
    });

    return mapCloreOrderToGPUInstance(raw, gpuLine, { port });
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

  /** @param {string} instanceId @param {string} jobId */
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
    try {
      const comfy = await this.getComfyClient(instanceId);
      const payload = await comfy.healthCheck();
      const status = mapComfyHealthToGPUStatus(payload);
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // If ComfyUI is not reachable yet, check if order is at least running
      if (/network|timeout|ECONN|endpoint not available|proxy is starting/i.test(message)) {
        try {
          const raw = await this.getOrderInternal(instanceId);
          if (raw) {
            const gpuLine = this.instanceGpuLines.get(instanceId) ?? 'rtx4090_1x';
            const port = this.instanceInternalPorts.get(instanceId) ?? DEFAULT_GPU_PORT;
            const instance = mapCloreOrderToGPUInstance(raw, gpuLine, { port });
            return {
              healthy: false,
              message: instance.status?.message ?? 'ComfyUI not ready yet',
              checkedAt: new Date().toISOString(),
            };
          }
        } catch {
          // Fall through
        }
      }

      if (error instanceof GPUInstanceNotFoundError) throw error;
      return {
        healthy: false,
        message: message || 'Health check failed',
        checkedAt: new Date().toISOString(),
      };
    }
  }
}