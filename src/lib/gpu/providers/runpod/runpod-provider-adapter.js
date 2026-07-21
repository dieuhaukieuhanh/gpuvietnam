import { RUNPOD_CAPABILITIES } from '../../provider-abstraction/provider-capabilities.js';
import { createStubProviderAdapter } from '../stubs/stub-provider-base.js';
import { RunpodClient } from './runpod-client.js';

/**
 * RunPod adapter — capability registered; runtime create goes through RunpodClient
 * (walkRentCandidates + cancelOrphan) once configured.
 * @param {{ client?: RunpodClient; apiKey?: string|null }} [options]
 * @returns {import('../../provider-abstraction/provider-interface.js').ProviderAdapter}
 */
export function createRunpodProviderAdapter(options = {}) {
  const client = options.client ?? new RunpodClient(options);
  const base = createStubProviderAdapter('runpod', 'RunPod', '0.0.0-stub', RUNPOD_CAPABILITIES);
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

/** @deprecated Use createRunpodProviderAdapter */
export const RunpodProviderAdapter = createRunpodProviderAdapter;
