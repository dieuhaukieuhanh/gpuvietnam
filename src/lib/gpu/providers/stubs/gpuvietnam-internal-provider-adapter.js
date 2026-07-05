import { GPUVIETNAM_INTERNAL_CAPABILITIES } from '../../provider-abstraction/provider-capabilities.js';
import { createStubProviderAdapter } from './stub-provider-base.js';

/** @returns {import('../../provider-abstraction/provider-interface.js').ProviderAdapter} */
export function createGpuVietnamInternalProviderAdapter() {
  return createStubProviderAdapter(
    'gpuvietnam_internal',
    'GPUVietnam Internal',
    '0.0.0-stub',
    GPUVIETNAM_INTERNAL_CAPABILITIES,
  );
}

export const GpuVietnamInternalProviderAdapter = createGpuVietnamInternalProviderAdapter;
