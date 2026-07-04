import {
  DEFAULT_DISK_SIZE,
  DEFAULT_GPU_IMAGE,
  DEFAULT_GPU_PORT,
  getDefaultGpuRegions,
} from './gpu-config.js';
import { GPUProviderError, isGpuUnavailableError } from './gpu-errors.js';

/** @typedef {import('./gpu-service').GPUService} GPUService */
/** @typedef {import('./domain/gpu-instance').GPULine} GPULine */
/** @typedef {import('./domain/gpu-instance').GPUInstance} GPUInstance */

/**
 * @typedef {Object} ProvisionGpuParams
 * @property {GPULine} gpuLine
 * @property {string[]} [regions]
 * @property {string} [image]
 * @property {number} [diskSize]
 * @property {number} [port]
 * @property {string} [label]
 * @property {Record<string, string>} [env]
 */

/**
 * Try each region until an instance is created.
 * @param {GPUService} gpuService
 * @param {ProvisionGpuParams} params
 * @returns {Promise<GPUInstance>}
 */
export async function provisionGpuInstance(gpuService, params) {
  const regions = params.regions ?? getDefaultGpuRegions();
  const image = params.image ?? DEFAULT_GPU_IMAGE;
  const diskSize = params.diskSize ?? DEFAULT_DISK_SIZE;
  const port = params.port ?? DEFAULT_GPU_PORT;
  let lastError;

  for (const region of regions) {
    try {
      return await gpuService.createInstance({
        gpuLine: params.gpuLine,
        region,
        image,
        diskSize,
        port,
        label: params.label,
        env: params.env,
      });
    } catch (error) {
      lastError = error;
      if (!isGpuUnavailableError(error)) {
        throw error;
      }
    }
  }

  if (lastError instanceof GPUProviderError) {
    throw new GPUProviderError('Đang hết GPU, vui lòng thử lại sau', {
      operation: lastError.operation,
      cause: lastError,
      retryable: false,
    });
  }

  throw new GPUProviderError('Đang hết GPU, vui lòng thử lại sau', { retryable: false });
}
