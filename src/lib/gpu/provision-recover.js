import { VastClient } from './providers/vast/vast-client.js';
import { mapVastInstanceToGPUInstance } from './providers/vast/vast-mapper.js';
import { CloreClient } from './providers/clore/clore-client.js';
import { mapCloreOrderToGPUInstance } from './providers/clore/clore-mapper.js';
import {
  extractCloreOrderId,
  extractCloreServerId,
  isCloreOrderActive,
  isGpuVietnamCloreOrder,
} from './providers/clore/clore-client.js';
import { logCloreOrphanEvent } from './providers/clore/clore-orphan-log.js';
import { incrCloreOrphanMetric } from './providers/clore/clore-orphan-metrics.js';
import { STALE_PROVISIONING_CLAIM_MS } from '../machines-provisioning-sync.js';

/**
 * After a rent response missing instance id, try to recover via attempt label (Vast only).
 *
 * @param {string} label
 * @param {import('./domain/gpu-instance').GPULine} [gpuLine]
 * @returns {Promise<import('./domain/gpu-instance').GPUInstance | null>}
 */
export async function recoverRentedInstanceByLabel(label, gpuLine = 'rtx4090_1x') {
  const trimmed = String(label ?? '').trim();
  if (!trimmed) return null;

  try {
    const client = new VastClient();
    if (!(process.env.VAST_AI_KEY ?? process.env.VAST_API_KEY ?? '').trim()) {
      return null;
    }
    const rows = await client.listInstancesByLabel(trimmed);
    if (!rows.length) return null;
    const first = rows[0];
    const id = String(first.id ?? first.instance_id ?? '');
    if (!id) return null;
    console.warn('[provision-recover] Recovered instance by label', { label: trimmed, instanceId: id });
    return mapVastInstanceToGPUInstance(first, gpuLine, { instanceIdHint: id });
  } catch (error) {
    console.warn(
      '[provision-recover] label lookup failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Recover a recently created Clore order that is not yet linked in DB.
 * Prefer serverId when known; otherwise pick newest GPUVietnam order within maxAgeMs.
 *
 * @param {{
 *   serverId?: string | number | null;
 *   label?: string | null;
 *   gpuLine?: import('./domain/gpu-instance').GPULine;
 *   maxAgeMs?: number;
 *   requestId?: string | null;
 * }} [options]
 * @returns {Promise<import('./domain/gpu-instance').GPUInstance | null>}
 */
export async function recoverCloreRentedInstance(options = {}) {
  const gpuLine = options.gpuLine ?? 'rtx4090_1x';
  const maxAgeMs = options.maxAgeMs ?? STALE_PROVISIONING_CLAIM_MS;
  const requestId = options.requestId ?? null;
  const started = Date.now();

  try {
    const client = new CloreClient();
    if (!client.isConfigured()) return null;

    const orders = await client.listMyOrders();
    const wantServer = options.serverId != null ? String(options.serverId).trim() : '';
    const nowSec = Math.floor(Date.now() / 1000);

    /** @type {Record<string, unknown>[]} */
    let candidates = orders.filter(
      (order) => isCloreOrderActive(order) && isGpuVietnamCloreOrder(order),
    );

    if (wantServer) {
      candidates = candidates.filter((order) => extractCloreServerId(order) === wantServer);
    } else {
      candidates = candidates.filter((order) => {
        const ct = Number(order.ct ?? order.created ?? 0);
        if (!Number.isFinite(ct) || ct <= 0) return true;
        const createdSec = ct > 1e12 ? Math.floor(ct / 1000) : ct;
        return nowSec - createdSec <= Math.ceil(maxAgeMs / 1000);
      });
    }

    if (!candidates.length) {
      logCloreOrphanEvent(
        'ORDER_ID_RECOVERY_FAILED',
        {
          requestId,
          provider: 'clore',
          serverId: wantServer || null,
          orderId: null,
          elapsedTime: Date.now() - started,
          recoveryAction: 'provision_recover',
          label: options.label ?? null,
        },
        'No Clore order found for provision recovery',
      );
      return null;
    }

    candidates.sort((a, b) => {
      const idA = Number(a.order_id ?? a.id ?? 0);
      const idB = Number(b.order_id ?? b.id ?? 0);
      if (idA !== idB) return idB - idA;
      return Number(b.ct ?? b.created ?? 0) - Number(a.ct ?? a.created ?? 0);
    });

    const first = candidates[0];
    const orderId = extractCloreOrderId(first);
    if (!orderId) return null;

    incrCloreOrphanMetric('orphanRecovered');
    logCloreOrphanEvent(
      'ORDER_ID_RECOVERY_SUCCESS',
      {
        requestId,
        provider: 'clore',
        orderId,
        serverId: extractCloreServerId(first) || null,
        machineId: orderId,
        elapsedTime: Date.now() - started,
        recoveryAction: 'provision_recover',
        label: options.label ?? null,
      },
      'Recovered Clore rented instance for provision',
    );

    return mapCloreOrderToGPUInstance(first, gpuLine, { instanceIdHint: orderId });
  } catch (error) {
    logCloreOrphanEvent(
      'ORDER_ID_RECOVERY_FAILED',
      {
        requestId,
        provider: 'clore',
        serverId: options.serverId != null ? String(options.serverId) : null,
        orderId: null,
        elapsedTime: Date.now() - started,
        recoveryAction: 'provision_recover',
        err: { message: error instanceof Error ? error.message : String(error) },
      },
      'Clore provision recovery failed',
    );
    return null;
  }
}

/**
 * Try Vast label recovery, then Clore my_orders recovery.
 *
 * @param {string} label
 * @param {import('./domain/gpu-instance').GPULine} [gpuLine]
 * @param {{ requestId?: string | null }} [options]
 */
export async function recoverRentedInstance(label, gpuLine = 'rtx4090_1x', options = {}) {
  const vast = await recoverRentedInstanceByLabel(label, gpuLine);
  if (vast?.id) return vast;
  return recoverCloreRentedInstance({
    label,
    gpuLine,
    requestId: options.requestId ?? null,
  });
}
