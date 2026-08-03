import {
  DEFAULT_GPU_PORT,
  NO_AVAILABLE_WORKSTATION_MESSAGE,
  isCloreGpuLineSupported,
  resolveGpuImage,
  resolvePackageDiskSize,
  resolvePackageSpec,
} from './gpu-config.js';
import { GPUProviderError } from './gpu-errors.js';
import {
  bootstrapProviderRegistry,
  getProviderAdapter,
  tryGetProviderAdapter,
} from './provider-abstraction/index.js';
import {
  provisionWithProviderFailover,
  resolveProviderAttemptOrder,
  isCloreOnlyMode,
  isSaladOnlyMode,
} from './provider-routing.js';
import { CloreClient } from './providers/clore/clore-client.js';
import { logger } from '../logging/index.js';

/** @typedef {import('./domain/gpu-instance').GPULine} GPULine */
/** @typedef {import('./domain/gpu-instance').GPUInstance} GPUInstance */

/**
 * @typedef {Object} ProvisionGpuParams
 * @property {GPULine} gpuLine
 * @property {string} [plan]
 * @property {string[]} [regions]
 * @property {string} [image]
 * @property {number} [diskSize]
 * @property {number} [port]
 * @property {string} [label]
 * @property {Record<string, string>} [env]
 * @property {'clore'|'vast'|'salad'} [forceProvider]
 * @property {(step: string) => void | Promise<void>} [onProgress]
 */

/**
 * Level 1 provider routing + Level 2 offer selection via each provider adapter.
 * @param {unknown} [_gpuService] unused — kept for call-site compatibility
 * @param {ProvisionGpuParams} params
 * @returns {Promise<GPUInstance>}
 */
export async function provisionGpuInstance(_gpuService, params) {
  bootstrapProviderRegistry();

  const packageSpec = resolvePackageSpec(params.plan, params.gpuLine);
  const image = params.image ?? resolveGpuImage(params.gpuLine);
  const diskSize = params.diskSize ?? resolvePackageDiskSize(params.plan, params.gpuLine);
  const port = params.port ?? DEFAULT_GPU_PORT;

  const createParams = {
    gpuLine: params.gpuLine,
    plan: params.plan ?? packageSpec.planKey,
    image,
    diskSize,
    port,
    label: params.label,
    env: params.env,
    onProgress: params.onProgress,
  };

  const cloreClient = new CloreClient();

  return provisionWithProviderFailover({
    gpuLine: params.gpuLine,
    attemptOrder: resolveProviderAttemptOrder({
      forcedPrimary: params.forceProvider,
      gpuLine: params.gpuLine,
    }),
    isConfigured(providerId) {
      if (providerId === 'salad') {
        return Boolean((process.env.SALAD_API_KEY ?? '').trim()) &&
          Boolean((process.env.SALAD_ORGANIZATION ?? '').trim()) &&
          Boolean((process.env.SALAD_PROJECT ?? '').trim());
      }
      if (providerId === 'clore') {
        return cloreClient.isConfigured() && isCloreGpuLineSupported(params.gpuLine);
      }
      if (providerId === 'vast') {
        if (isCloreOnlyMode() || isSaladOnlyMode()) return false;
        return Boolean((process.env.VAST_AI_KEY ?? process.env.VAST_API_KEY ?? '').trim());
      }
      return false;
    },
    async createWithProvider(providerId) {
      if (providerId === 'vast' && (isCloreOnlyMode() || isSaladOnlyMode())) {
        throw new GPUProviderError('Provider-only mode: refusing Vast provision', {
          retryable: false,
          code: 'PROVIDER_ONLY_REFUSE_VAST',
        });
      }
      if (providerId === 'salad' && isCloreOnlyMode()) {
        throw new GPUProviderError('Clore-only mode: refusing Salad provision', {
          retryable: false,
          code: 'CLORE_ONLY_REFUSE_SALAD',
        });
      }
      const adapter = tryGetProviderAdapter(providerId) ?? getProviderAdapter(providerId);
      if (params.onProgress) await params.onProgress('provider_attempt_' + providerId);
      logger('provider').info(
        {
          operation: 'provision.createMachine',
          phase: 'START',
          providerId,
          plan: createParams.plan,
          gpuLine: createParams.gpuLine,
          image,
          diskGb: diskSize,
          cloreOnly: isCloreOnlyMode(),
        },
        `provider=${providerId} plan=${createParams.plan} gpu=${createParams.gpuLine} image=${image} disk=${diskSize}GB`,
      );
      return adapter.createMachine(createParams);
    },
  }).catch((error) => {
    if (error instanceof GPUProviderError) throw error;
    throw new GPUProviderError(NO_AVAILABLE_WORKSTATION_MESSAGE, {
      retryable: false,
      cause: error instanceof Error ? error : undefined,
    });
  });
}
