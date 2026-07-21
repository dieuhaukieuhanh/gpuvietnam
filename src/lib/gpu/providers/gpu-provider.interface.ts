import type { GPUInstance, GPULine } from '../domain/gpu-instance';
import type { GPUJob, GPUOutput } from '../domain/gpu-job';
import type { GPUProviderInfo } from '../domain/gpu-provider-info';
import type { GPUStatus } from '../domain/gpu-status';

export interface CreateInstanceParams {
  gpuLine: GPULine;
  region?: string;
  image?: string;
  label?: string;
  env?: Record<string, string>;
  diskSize?: number;
  port?: number;
  plan?: string;
  /** Dual-run / Render an toàn — skip these host keys (same host as Attempt A, etc.). */
  excludeHostKeys?: string[];
}

export interface SubmitWorkflowParams {
  workflow: Record<string, unknown>;
  clientId?: string;
}

export interface UploadWorkflowParams {
  filename: string;
  workflow: Record<string, unknown>;
}

export interface GPUProvider {
  getInfo(): GPUProviderInfo;

  /**
   * Rent one workstation. Marketplace providers (clore, vast, salad, runpod) that walk multiple offers
   * MUST use `walkRentCandidates` (cancel orphan before next host).
   */
  createInstance(params: CreateInstanceParams): Promise<GPUInstance>;
  destroyInstance(instanceId: string): Promise<void>;
  getInstanceStatus(instanceId: string): Promise<GPUInstance>;

  submitWorkflow(instanceId: string, params: SubmitWorkflowParams): Promise<GPUJob>;
  getJobStatus(instanceId: string, jobId: string): Promise<GPUJob>;
  downloadOutputs(instanceId: string, jobId: string): Promise<GPUOutput[]>;
  uploadWorkflow(instanceId: string, params: UploadWorkflowParams): Promise<void>;

  healthCheck(instanceId: string): Promise<GPUStatus>;
}
