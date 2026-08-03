/**
 * SaladCloud Provider Adapter — implements the 9-method ProviderAdapter interface.
 *
 * Salad uses a container-group model:
 *   create container group → start → poll running → health check → return GPUInstance
 *
 * There is no marketplace / offer walking. listOffers() returns [].
 */

import { SALAD_CAPABILITIES } from '../../provider-abstraction/provider-capabilities.js';
import { SaladClient } from './salad-client.js';
import { runSaladProvisionGate } from './salad-provision-gate.js';
import { GPUProviderError } from '../../gpu-errors.js';
import {
  rememberHostFailure,
  rememberHostSuccess,
} from '../../host-reputation/index.js';

export class SaladProviderAdapter {
  /**
   * @param {{
   *   client?: SaladClient;
   *   apiKey?: string | null;
   *   organization?: string | null;
   *   project?: string | null;
   *   priority?: string | null;
   * }} [options]
   */
  constructor(options = {}) {
    this.client = options.client ?? new SaladClient(options);
  }

  // -----------------------------------------------------------------------
  // ProviderAdapter interface
  // -----------------------------------------------------------------------

  /** @returns {import('../../provider-abstraction/provider-interface.js').ProviderInfo} */
  getInfo() {
    return { id: 'salad', name: 'SaladCloud', version: '1.0.0' };
  }

  /** @returns {import('../../provider-abstraction/provider-capabilities.js').ProviderCapabilities} */
  getCapabilities() {
    return SALAD_CAPABILITIES;
  }

  /**
   * Create and start a Salad container, run health check, return GPUInstance.
   * @param {import('../../provider-abstraction/provider-interface.js').CreateMachineParams} params
   * @returns {Promise<import('../../domain/gpu-instance').GPUInstance>}
   */
  async createMachine(params) {
    const instance = await this.client.createInstance(params);

    // Run Quick Health Check before returning.
    const hostRepKey =
      instance.metadata && typeof instance.metadata === 'object'
        ? String(/** @type {Record<string,unknown>} */ (instance.metadata).hostReputationKey || '')
        : '';

    const gateResult = await runSaladProvisionGate(instance.endpointUrl, {
      gpuLine: instance.gpuLine,
      port: typeof instance.metadata === 'object' && instance.metadata
        ? Number(/** @type {Record<string,unknown>} */ (instance.metadata).port) || undefined
        : undefined,
    });

    if (!gateResult.ok) {
      // Health check failed — destroy the container and report.
      console.error('[salad/adapter] Provision gate failed:', gateResult.detail);
      try {
        await this.client.destroyInstance(instance.id);
      } catch (destroyErr) {
        console.error('[salad/adapter] Cleanup destroy failed:', destroyErr);
      }

      // Record host reputation failure.
      if (hostRepKey) {
        rememberHostFailure(hostRepKey, {
          reason: gateResult.detail,
          category: gateResult.step,
          phase: 'provision_gate',
          gpuLine: instance.gpuLine,
        });
      }

      throw new GPUProviderError(
        `Salad health check failed: ${gateResult.detail}`,
        { retryable: true },
      );
    }

    // Record host reputation success.
    if (hostRepKey) {
      rememberHostSuccess(hostRepKey, {
        gpuLine: instance.gpuLine,
        readyLatencyMs: gateResult.elapsedMs,
      });
    }

    // Return instance with gate result metadata.
    return {
      ...instance,
      metadata: {
        ...(typeof instance.metadata === 'object' && instance.metadata ? instance.metadata : {}),
        gateSteps: gateResult.steps,
        gateElapsedMs: gateResult.elapsedMs,
      },
    };
  }

  /**
   * Destroy a Salad container group.
   * @param {string} instanceId — container group name
   * @returns {Promise<void>}
   */
  async destroyMachine(instanceId) {
    return this.client.destroyInstance(instanceId);
  }

  /**
   * Get live status of a Salad container group.
   * @param {string} instanceId — container group name
   * @returns {Promise<import('../../domain/gpu-instance').GPUInstance>}
   */
  async getMachine(instanceId) {
    const group = await this.client.getContainerGroup(instanceId);

    const internalState = mapSaladStateToInternal(group.current_state);
    const endpointUrl = this.client.resolveEndpointUrl(instanceId, group.networking);

    return {
      id: group.name,
      providerId: 'salad',
      providerName: 'SaladCloud',
      gpuLine: /** @type {import('../../domain/gpu-instance').GPULine} */ ('rtx3090'), // best-effort
      status: internalState,
      region: 'global',
      endpointUrl: endpointUrl || undefined,
      metadata: {
        containerGroupName: group.name,
        saladState: group.current_state,
        instances: group.instances,
        networking: group.networking,
      },
    };
  }

  /**
   * Salad has no marketplace — return empty offer list.
   * @returns {Promise<import('../../provider-abstraction/provider-interface.js').ProviderOffer[]>}
   */
  async listOffers() {
    return [];
  }

  /**
   * Salad is globally distributed with no region selection.
   * @returns {Promise<import('../../provider-abstraction/provider-interface.js').ProviderRegion[]>}
   */
  async listRegions() {
    return [{ id: 'global', label: 'Global (Salad distributed network)', score: 50 }];
  }

  /**
   * Health check: API connectivity + quotas.
   * @param {string} [instanceId] — if provided, check specific container group
   * @returns {Promise<import('../../provider-abstraction/provider-interface.js').ProviderHealthResult>}
   */
  async health(instanceId) {
    try {
      const quotas = await this.client.getQuotas();
      const hasQuota = quotas.containerReplicasUsed < quotas.containerReplicasQuota;

      if (instanceId) {
        const group = await this.client.getContainerGroup(instanceId);
        const healthy = group.current_state === 'running';
        return {
          healthy,
          message: healthy
            ? `Container ${instanceId} running`
            : `Container ${instanceId} state: ${group.current_state}`,
          checkedAt: new Date().toISOString(),
        };
      }

      return {
        healthy: hasQuota,
        message: hasQuota
          ? `Salad API OK (${quotas.containerReplicasUsed}/${quotas.containerReplicasQuota} replicas)`
          : `Salad quota exhausted (${quotas.containerReplicasUsed}/${quotas.containerReplicasQuota})`,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        healthy: false,
        message: `Salad health check failed: ${err instanceof Error ? err.message : String(err)}`,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Verify that a specific container is actually running.
   * @param {string} instanceId — container group name
   * @returns {Promise<import('../../provider-abstraction/provider-interface.js').VerifyRunningResult>}
   */
  async verifyRunning(instanceId) {
    try {
      const group = await this.client.getContainerGroup(instanceId);
      const running = group.current_state === 'running';
      const hasRunningInstance = group.instances.some(
        (inst) => inst.state === 'running',
      );
      return {
        running: running && hasRunningInstance,
        normalizedState: mapSaladStateToInternal(group.current_state),
        message: running && hasRunningInstance
          ? `Container ${instanceId} running`
          : `Container ${instanceId} state: ${group.current_state}, instances: ${group.instances.length}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        running: false,
        normalizedState: 'stopped',
        message: `verifyRunning failed: ${err instanceof Error ? err.message : String(err)}`,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// State mapping
// ---------------------------------------------------------------------------

/**
 * Map Salad container group / instance states to internal lifecycle states.
 *
 * @param {string} saladState
 * @returns {'booting' | 'running' | 'stopped'}
 */
function mapSaladStateToInternal(saladState) {
  const s = String(saladState ?? '').toLowerCase();
  switch (s) {
    case 'running':
      return 'running';
    case 'preparing':
    case 'deploying':
    case 'allocating':
    case 'downloading':
    case 'creating':
      return 'booting';
    case 'stopped':
    case 'failed':
    default:
      return 'stopped';
  }
}

/** @deprecated Use `new SaladProviderAdapter()` instead. */
export const createSaladProviderAdapter = (options) => new SaladProviderAdapter(options);
