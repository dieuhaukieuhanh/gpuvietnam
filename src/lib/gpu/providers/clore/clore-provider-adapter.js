/**
 * Clore Provider Adapter — Level 1 routing target.
 */

import { CLORE_CAPABILITIES, defineProviderCapabilities } from '../../provider-abstraction/provider-capabilities.js';
import { CloreProvider } from './clore-provider.js';
import { CloreClient } from './clore-client.js';
import { PROVIDER_ID, PROVIDER_NAME } from './clore-mapper.js';

/** @typedef {import('../../provider-abstraction/provider-interface.js').ProviderAdapter} ProviderAdapter */
/** @typedef {import('../../provider-abstraction/provider-interface.js').CreateMachineParams} CreateMachineParams */
/** @typedef {import('../../provider-abstraction/provider-interface.js').ListOffersParams} ListOffersParams */

/**
 * @implements {ProviderAdapter}
 */
export class CloreProviderAdapter {
  /**
   * @param {{ legacyProvider?: CloreProvider; client?: CloreClient }} [options]
   */
  constructor(options = {}) {
    this.legacyProvider = options.legacyProvider ?? new CloreProvider(options);
    this.client = options.client ?? this.legacyProvider.client ?? new CloreClient();
  }

  getInfo() {
    return {
      id: PROVIDER_ID,
      name: PROVIDER_NAME,
      version: '1.0.0',
    };
  }

  getCapabilities() {
    return defineProviderCapabilities({
      ...CLORE_CAPABILITIES,
    });
  }

  /**
   * Cached capability snapshot (SWR). Independent of live marketplace inventory.
   * @param {{ forceRefresh?: boolean; requestId?: string|null }} [options]
   */
  async getCapabilitiesCached(options = {}) {
    const { getCloreCapabilitiesCached } = await import(
      '../../../provider-capability-cache/index.js'
    );
    return getCloreCapabilitiesCached(this.client, options);
  }

  /** @param {CreateMachineParams} params */
  async createMachine(params) {
    return this.legacyProvider.createInstance(params);
  }

  /** @param {string} instanceId */
  async destroyMachine(instanceId) {
    return this.legacyProvider.destroyInstance(instanceId);
  }

  /** @param {string} instanceId */
  async getMachine(instanceId) {
    return this.legacyProvider.getInstanceStatus(instanceId);
  }

  /** @param {ListOffersParams} params */
  async listOffers(params) {
    const ranked = await this.client.findRankedOffers(params.gpuLine, params.plan);
    return ranked.slice(0, params.limit ?? 10).map((item) => ({
      offerId: item.offerId,
      region: item.region,
      pricePerHour: item.pricePerHour,
      gpuType: item.gpuType,
      score: item.uptimePercent,
      reason: item.reason,
    }));
  }

  async listRegions() {
    return [{ id: 'global', label: 'Global', score: 50 }];
  }

  /** @param {string} [instanceId] */
  async health(instanceId) {
    const checkedAt = new Date().toISOString();
    if (!instanceId) {
      const configured = this.client.isConfigured();
      return {
        healthy: configured,
        message: configured ? 'Clore API configured' : 'CLORE_API_KEY is not configured',
        checkedAt,
      };
    }
    const status = await this.legacyProvider.healthCheck(instanceId);
    return {
      healthy: status.healthy,
      message: status.message,
      checkedAt: status.checkedAt ?? checkedAt,
    };
  }

  /** @param {string} instanceId */
  async verifyRunning(instanceId) {
    const status = await this.legacyProvider.getInstanceStatus(instanceId);
    const running = status.status?.code === 'running';
    return {
      running,
      normalizedState: status.status?.code ?? 'unknown',
      message: status.status?.message ?? null,
      checkedAt: new Date().toISOString(),
    };
  }
}
