/**
 * SCB 2.1 Phase 3 — Bridge ProviderAdapter → legacy GPUProvider (GPUService compat).
 * Preserves existing GPUService method signatures without changing business callers.
 */

/** @typedef {import('../providers/gpu-provider.interface').GPUProvider} GPUProvider */
/** @typedef {import('./provider-interface.js').ProviderAdapter} ProviderAdapter */

/**
 * @param {ProviderAdapter} adapter
 * @returns {GPUProvider}
 */
export function createLegacyGpuProviderBridge(adapter) {
  return {
    getInfo() {
      const info = adapter.getInfo();
      return {
        id: info.id,
        name: info.name,
        version: info.version,
      };
    },

    createInstance(params) {
      return adapter.createMachine(params);
    },

    destroyInstance(instanceId) {
      return adapter.destroyMachine(instanceId);
    },

    getInstanceStatus(instanceId) {
      return adapter.getMachine(instanceId);
    },

    submitWorkflow(instanceId, params) {
      const legacy = /** @type {GPUProvider & { submitWorkflow?: Function }} */ (adapter);
      if (typeof legacy.submitWorkflow === 'function') {
        return legacy.submitWorkflow(instanceId, params);
      }
      return getWorkflowDelegate(adapter).submitWorkflow(instanceId, params);
    },

    getJobStatus(instanceId, jobId) {
      return getWorkflowDelegate(adapter).getJobStatus(instanceId, jobId);
    },

    downloadOutputs(instanceId, jobId) {
      return getWorkflowDelegate(adapter).downloadOutputs(instanceId, jobId);
    },

    uploadWorkflow(instanceId, params) {
      return getWorkflowDelegate(adapter).uploadWorkflow(instanceId, params);
    },

    healthCheck(instanceId) {
      return adapter.health(instanceId).then((result) => ({
        code: result.healthy ? 'running' : 'failed',
        healthy: result.healthy,
        message: result.message,
        checkedAt: result.checkedAt,
      }));
    },
  };
}

/** @type {WeakMap<ProviderAdapter, GPUProvider>} */
const workflowDelegates = new WeakMap();

/**
 * @param {ProviderAdapter} adapter
 * @returns {GPUProvider}
 */
function getWorkflowDelegate(adapter) {
  const existing = workflowDelegates.get(adapter);
  if (existing) return existing;

  const delegate = /** @type {GPUProvider & { __workflow?: GPUProvider }} */ (adapter).__workflow;
  if (delegate) {
    workflowDelegates.set(adapter, delegate);
    return delegate;
  }

  throw new Error(
    `Provider ${adapter.getInfo().id} has no workflow delegate — Comfy operations unavailable`,
  );
}

/**
 * Attach workflow-capable legacy provider for ComfyUI operations.
 *
 * @param {ProviderAdapter} adapter
 * @param {GPUProvider} workflowProvider
 * @returns {ProviderAdapter}
 */
export function attachWorkflowDelegate(adapter, workflowProvider) {
  /** @type {ProviderAdapter & { __workflow?: GPUProvider }} */ (adapter).__workflow = workflowProvider;
  return adapter;
}
