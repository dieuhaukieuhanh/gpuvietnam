import { INTERDATA_CAPABILITIES } from '../../provider-abstraction/provider-capabilities.js';
import { createStubProviderAdapter } from './stub-provider-base.js';

/** @returns {import('../../provider-abstraction/provider-interface.js').ProviderAdapter} */
export function createInterDataProviderAdapter() {
  return createStubProviderAdapter(
    'interdata',
    'InterData',
    '0.0.0-stub',
    INTERDATA_CAPABILITIES,
  );
}

export const InterDataProviderAdapter = createInterDataProviderAdapter;
