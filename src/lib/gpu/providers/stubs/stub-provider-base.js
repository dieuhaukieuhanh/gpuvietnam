/**
 * SCB 2.1 Phase 3 — Stub provider adapter base (capability-only, not implemented).
 */

import { GPUProviderError } from '../../gpu-errors.js';

/**
 * @param {string} providerId
 * @returns {never}
 */
export function throwProviderNotImplemented(providerId) {
  throw new GPUProviderError(`Provider ${providerId} is not implemented (Phase 3 stub)`, {
    retryable: false,
  });
}

/**
 * @param {string} providerId
 * @param {string} name
 * @param {string} version
 * @param {import('../../provider-abstraction/provider-capabilities.js').ProviderCapabilities} capabilities
 */
export function createStubProviderAdapter(providerId, name, version, capabilities) {
  return {
    getInfo() {
      return { id: providerId, name, version };
    },
    getCapabilities() {
      return capabilities;
    },
    async createMachine() {
      throwProviderNotImplemented(providerId);
    },
    async destroyMachine() {
      throwProviderNotImplemented(providerId);
    },
    async getMachine() {
      throwProviderNotImplemented(providerId);
    },
    listOffers() {
      return Promise.resolve([]);
    },
    listRegions() {
      return Promise.resolve(
        capabilities.regions.map((label) => ({
          id: String(label).toLowerCase().replace(/\s+/g, '-'),
          label: String(label),
        })),
      );
    },
    async health() {
      return {
        healthy: false,
        message: `${name} stub — not configured`,
        checkedAt: new Date().toISOString(),
      };
    },
    async verifyRunning() {
      throwProviderNotImplemented(providerId);
    },
  };
}
