import { SALAD_CAPABILITIES } from '../../provider-abstraction/provider-capabilities.js';
import { createStubProviderAdapter } from '../stubs/stub-provider-base.js';
import { SaladClient } from './salad-client.js';

/**
 * Salad adapter — capability registered; runtime create goes through SaladClient
 * (walkRentCandidates + cancelOrphan) once configured.
 * @param {{ client?: SaladClient; apiKey?: string|null }} [options]
 * @returns {import('../../provider-abstraction/provider-interface.js').ProviderAdapter}
 */
export function createSaladProviderAdapter(options = {}) {
  const client = options.client ?? new SaladClient(options);
  const base = createStubProviderAdapter('salad', 'Salad', '0.0.0-stub', SALAD_CAPABILITIES);
  return {
    ...base,
    /** @param {import('../../provider-abstraction/provider-interface.js').CreateMachineParams} params */
    async createMachine(params) {
      return client.createInstance(params);
    },
    async destroyMachine(instanceId) {
      return client.destroyInstance(instanceId);
    },
  };
}

/** @deprecated Use createSaladProviderAdapter */
export const SaladProviderAdapter = createSaladProviderAdapter;
