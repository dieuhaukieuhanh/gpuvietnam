/**
 * Runtime mirror of gpu-status.ts for Node ESM tests and plain .js imports.
 * Keep in sync with gpu-status.ts.
 */

/** @typedef {'pending'|'starting'|'running'|'stopping'|'stopped'|'failed'|'unknown'} GPUStatusCode */

/**
 * @param {GPUStatusCode} code
 * @param {{ healthy?: boolean; message?: string }} [options]
 */
export function createGPUStatus(code, options = {}) {
  return {
    code,
    healthy: options.healthy ?? code === 'running',
    message: options.message,
    checkedAt: new Date().toISOString(),
  };
}
