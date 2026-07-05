/**
 * Mock provider adapter for contract tests — no external network.
 */

import { defineProviderCapabilities } from './provider-capabilities.js';

/**
 * @returns {import('./provider-interface.js').ProviderAdapter}
 */
export function createMockProviderAdapter() {
  const caps = defineProviderCapabilities({
    supportsSpot: true,
    supportsDocker: true,
    gpuTypes: ['rtx4090_1x'],
    regions: ['test-region'],
    implemented: true,
  });

  return {
    getInfo() {
      return { id: 'mock', name: 'Mock Provider', version: 'test' };
    },
    getCapabilities() {
      return caps;
    },
    async createMachine(params) {
      return {
        id: 'mock-instance-1',
        providerId: 'mock',
        gpuLine: params.gpuLine,
        status: { code: 'running' },
      };
    },
    async destroyMachine() {},
    async getMachine(instanceId) {
      return {
        id: instanceId,
        providerId: 'mock',
        gpuLine: 'rtx4090_1x',
        status: { code: 'running' },
      };
    },
    async listOffers() {
      return [
        {
          offerId: 'offer-1',
          region: 'test-region',
          pricePerHour: 1.5,
          gpuType: 'rtx4090_1x',
          score: 90,
        },
      ];
    },
    async listRegions() {
      return [{ id: 'test-region', label: 'Test Region', score: 90 }];
    },
    async health(instanceId) {
      return {
        healthy: true,
        message: instanceId ? `instance ${instanceId} ok` : 'platform ok',
        checkedAt: new Date().toISOString(),
      };
    },
    async verifyRunning() {
      return {
        running: true,
        normalizedState: 'running',
        checkedAt: new Date().toISOString(),
      };
    },
  };
}
