import type { GPUStatus } from './gpu-status';

export type GPULine = 'rtx3090' | 'rtx4090_1x' | 'rtx4090_2x';

export interface GPUInstance {
  id: string;
  providerId: string;
  providerName: string;
  gpuLine: GPULine;
  status: GPUStatus;
  region?: string;
  endpointUrl?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}
