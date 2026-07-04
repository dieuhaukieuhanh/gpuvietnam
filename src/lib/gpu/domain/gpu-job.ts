export type GPUJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface GPUOutput {
  id: string;
  filename: string;
  url?: string;
  mimeType?: string;
}

export interface GPUJob {
  id: string;
  instanceId: string;
  status: GPUJobStatus;
  progress?: number;
  errorMessage?: string;
  outputs?: GPUOutput[];
  createdAt?: string;
  completedAt?: string;
}
