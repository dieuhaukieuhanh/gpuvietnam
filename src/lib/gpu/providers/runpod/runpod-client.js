/**
 * RunPod marketplace client (stub runtime).
 * createInstance MUST walk offers via walkRentCandidates + cancelOrphan.
 */

import { GPUProviderError } from '../../gpu-errors.js';
import { walkRentCandidates } from '../../rent-candidate-walk.js';

export class RunpodClient {
  /**
   * @param {{ apiKey?: string|null }} [options]
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.RUNPOD_API_KEY ?? null;
  }

  /**
   * @param {string} _gpuLine
   * @returns {Promise<Array<{ offerId: string }>>}
   */
  async listRentCandidates(_gpuLine) {
    return [];
  }

  /**
   * @param {{ offerId: string }} candidate
   * @param {unknown} _params
   */
  async rentOffer(candidate, _params) {
    throw new GPUProviderError(`RunPod rent not implemented for offer ${candidate.offerId}`, {
      operation: 'runpod.rentOffer',
      retryable: false,
    });
  }

  /**
   * @param {{ offerId: string }} candidate
   */
  async cancelOrphanForOffer(candidate) {
    // Provider-specific: RunPod terminate pod / cancel bid once wired.
    void candidate;
  }

  /**
   * @param {{ gpuLine: string; region?: string; image?: string; label?: string; env?: Record<string, string>; diskSize?: number; port?: number }} params
   */
  async createInstance(params) {
    if (!this.apiKey) {
      throw new GPUProviderError('RunPod is not configured (missing RUNPOD_API_KEY)', {
        operation: 'runpod.createInstance',
        retryable: false,
      });
    }

    /** @type {Error | null} */
    let lastError = null;
    const candidates = await this.listRentCandidates(params.gpuLine);

    const walked = await walkRentCandidates({
      providerId: 'runpod',
      sourceLabel: 'initial',
      candidates,
      getOfferId: (c) =>
        c && typeof c === 'object' && 'offerId' in c
          ? /** @type {{ offerId?: string }} */ (c).offerId
          : null,
      rentOne: async (candidate) => this.rentOffer(/** @type {{ offerId: string }} */ (candidate), params),
      cancelOrphan: async (candidate) =>
        this.cancelOrphanForOffer(/** @type {{ offerId: string }} */ (candidate)),
      afterFailure: async ({ error }) => {
        lastError = error instanceof Error ? error : new Error(String(error));
        return 'continue';
      },
    });

    if (walked.result) return walked.result;

    throw new GPUProviderError(
      lastError?.message ?? walked.lastError?.message ?? 'No RunPod GPU offers available',
      {
        operation: 'runpod.createInstance',
        retryable: true,
        cause: lastError ?? walked.lastError ?? undefined,
      },
    );
  }

  /** @param {string} instanceId */
  async destroyInstance(instanceId) {
    void instanceId;
    throw new GPUProviderError('RunPod destroy not implemented', {
      operation: 'runpod.destroyInstance',
      retryable: false,
    });
  }
}
