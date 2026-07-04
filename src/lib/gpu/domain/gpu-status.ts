export type GPUStatusCode =
  | 'pending'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'unknown';

export interface GPUStatus {
  code: GPUStatusCode;
  healthy: boolean;
  message?: string;
  checkedAt: string;
}

export function createGPUStatus(
  code: GPUStatusCode,
  options: { healthy?: boolean; message?: string } = {},
): GPUStatus {
  return {
    code,
    healthy: options.healthy ?? code === 'running',
    message: options.message,
    checkedAt: new Date().toISOString(),
  };
}
