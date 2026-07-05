import { SALAD_CAPABILITIES } from '../../provider-abstraction/provider-capabilities.js';
import { createStubProviderAdapter } from './stub-provider-base.js';

/** @returns {import('../../provider-abstraction/provider-interface.js').ProviderAdapter} */
export function createSaladProviderAdapter() {
  return createStubProviderAdapter('salad', 'Salad', '0.0.0-stub', SALAD_CAPABILITIES);
}

/** @deprecated Use createSaladProviderAdapter — registry bootstrap alias */
export const SaladProviderAdapter = createSaladProviderAdapter;
