/**
 * SCB 2.1 Phase 3 — Vast Provider Adapter.
 * Wraps existing VastProvider/VastClient without changing Vast business logic.
 */

import { getDefaultGpuRegions } from '../../gpu-config.js';
import { getAsiaRegionScore } from '../../geo-asia.js';
import { readProviderStateSnapshot } from '../../provider-verify.js';
import { VAST_CAPABILITIES, defineProviderCapabilities } from '../../provider-abstraction/provider-capabilities.js';
import { VastProvider } from './vast-provider.js';
import { VastClient, findRankedGPUOffers } from './vast-client.js';
import { PROVIDER_ID, PROVIDER_NAME } from './vast-mapper.js';

/** @typedef {import('../../provider-abstraction/provider-interface.js').ProviderAdapter} ProviderAdapter */
/** @typedef {import('../../provider-abstraction/provider-interface.js').CreateMachineParams} CreateMachineParams */
/** @typedef {import('../../provider-abstraction/provider-interface.js').ListOffersParams} ListOffersParams */

/**
 * @implements {ProviderAdapter}
 */
export class VastProviderAdapter {
  /**
   * @param {{ legacyProvider?: VastProvider; client?: VastClient }} [options]
   */
  constructor(options = {}) {
    this.legacyProvider = options.legacyProvider ?? new VastProvider(options);
    this.client = options.client ?? this.legacyProvider.client ?? new VastClient();
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
      ...VAST_CAPABILITIES,
      regions: getDefaultGpuRegions(),
    });
  }

  /**
   * Cached capability snapshot (SWR). Independent of live marketplace inventory.
   * @param {{ forceRefresh?: boolean; requestId?: string|null }} [options]
   */
  async getCapabilitiesCached(options = {}) {
    const { getVastCapabilitiesCached } = await import(
      '../../../provider-capability-cache/index.js'
    );
    return getVastCapabilitiesCached(options);
  }

  /** @param {CreateMachineParams} params */
  async createMachine(params) {
    return this.legacyProvider.createInstance(params);
  }

  /** @param {string} instanceId */
  async destroyMachine(instanceId) {
    return this.legacyProvider.destroyInstance(instanceId);
  }

  /**
   * @param {string} label
   * @param {import('../../domain/gpu-instance').GPULine} [gpuLine]
   */
  async findMachineByLabel(label, gpuLine) {
    if (typeof this.legacyProvider.findInstanceByLabel === 'function') {
      return this.legacyProvider.findInstanceByLabel(label, gpuLine);
    }
    return null;
  }

  /** @param {string} instanceId */
  async getMachine(instanceId) {
    return this.legacyProvider.getInstanceStatus(instanceId);
  }

  /** @param {ListOffersParams} params */
  async listOffers(params) {
    let offerList = await this.client.searchOffers(params.gpuLine);

    if (params.region) {
      const needle = params.region.toLowerCase();
      const filtered = offerList.filter((offer) =>
        String(offer.geolocation ?? offer.location ?? offer.region ?? '')
          .toLowerCase()
          .includes(needle),
      );
      if (filtered.length > 0) offerList = filtered;
    }

    let ranked = [];
    try {
      ranked = findRankedGPUOffers(
        params.gpuLine,
        params.plan,
        offerList,
        params.limit ?? 10,
      );
    } catch {
      return [];
    }

    return ranked.map((item) => ({
      offerId: item.offerId,
      region: item.region,
      pricePerHour: item.pricePerHour,
      gpuType: item.gpuType,
      score: item.score,
      reason: item.reason,
    }));
  }

  async listRegions() {
    const defaults = getDefaultGpuRegions();
    return defaults.map((label) => {
      const key = label.toLowerCase();
      return {
        id: key.replace(/\s+/g, '-'),
        label,
        score: getAsiaRegionScore(label) || 50,
      };
    });
  }

  /** @param {string} [instanceId] */
  async health(instanceId) {
    const checkedAt = new Date().toISOString();
    if (!instanceId) {
      const configured = Boolean(
        (process.env.VAST_AI_KEY ?? process.env.VAST_API_KEY ?? '').trim(),
      );
      return {
        healthy: configured,
        message: configured ? 'Vast API configured' : 'VAST_AI_KEY is not configured',
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

  /** @param {string} instanceId @param {Record<string, unknown>} [options] */
  async verifyRunning(instanceId, options = {}) {
    const port = Number(options.port ?? process.env.DEFAULT_GPU_PORT ?? 8080);
    const snapshot = await readProviderStateSnapshot(instanceId, port, {
      port: {
        getInstanceStatus: (id) => this.getMachine(id),
        healthCheck: (id) => this.legacyProvider.healthCheck(id),
      },
    });

    return {
      running: snapshot.normalizedState === 'running',
      normalizedState: snapshot.normalizedState,
      message: snapshot.message ?? null,
      checkedAt: snapshot.checkedAt,
    };
  }
}