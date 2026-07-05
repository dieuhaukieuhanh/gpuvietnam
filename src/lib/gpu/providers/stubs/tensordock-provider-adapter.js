import { TENSORDOCK_CAPABILITIES } from '../../provider-abstraction/provider-capabilities.js';
import { createStubProviderAdapter } from './stub-provider-base.js';

/** @returns {import('../../provider-abstraction/provider-interface.js').ProviderAdapter} */
export function createTensorDockProviderAdapter() {
  return createStubProviderAdapter(
    'tensordock',
    'TensorDock',
    '0.0.0-stub',
    TENSORDOCK_CAPABILITIES,
  );
}

export const TensorDockProviderAdapter = createTensorDockProviderAdapter;
