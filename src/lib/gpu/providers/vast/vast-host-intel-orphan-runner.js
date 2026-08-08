/**
 * Schedule Vast host-intel orphan sweeps on the lifecycle worker.
 */

import { randomUUID } from 'node:crypto';
import { VastClient } from './vast-client.js';
import {
  resolveVastHostIntelOrphanGraceMs,
  runVastHostIntelOrphanPass,
} from './vast-host-intel-orphan.js';
import { logger } from '../../../logging/index.js';

/** @type {ReturnType<typeof setInterval> | null} */
let intervalHandle = null;

/** @type {Promise<unknown> | null} */
let activePass = null;

function isEnabled() {
  const raw = String(process.env.VAST_HOST_INTEL_ORPHAN_RECONCILE ?? 'true')
    .trim()
    .toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function resolveIntervalMs() {
  const raw = Number(process.env.VAST_HOST_INTEL_ORPHAN_INTERVAL_MS ?? 5 * 60 * 1000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 5 * 60 * 1000;
}

/**
 * @param {{ reason?: string }} [options]
 */
export async function kickVastHostIntelOrphanReconciliation(options = {}) {
  if (!isEnabled()) return { skipped: true, reason: 'disabled' };
  if (!process.env.VAST_AI_KEY && !process.env.VAST_API_KEY) {
    return { skipped: true, reason: 'no_vast_key' };
  }
  if (activePass) return activePass;

  activePass = (async () => {
    const requestId = randomUUID();
    try {
      const vastClient = new VastClient();
      const result = await runVastHostIntelOrphanPass({
        vastClient,
        graceMs: resolveVastHostIntelOrphanGraceMs(),
        requestId,
      });
      logger('provider').info(
        {
          operation: 'vast.host_intel_orphan',
          event: 'ORPHAN_RECONCILE_PASS',
          reason: options.reason ?? 'kick',
          listed: result.listed,
          destroyCandidates: result.destroyCandidates,
          requestId,
        },
        'Vast host-intel orphan reconciliation pass complete',
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger('provider').error(
        {
          operation: 'vast.host_intel_orphan',
          event: 'ORPHAN_RECONCILE_FAILED',
          reason: options.reason ?? 'kick',
          err: { message },
        },
        'Vast host-intel orphan reconciliation failed',
      );
      return { skipped: true, reason: message };
    } finally {
      activePass = null;
    }
  })();

  return activePass;
}

export function startVastHostIntelOrphanReconciliation() {
  if (!isEnabled()) {
    logger('app').info(
      { operation: 'vast.host_intel_orphan', event: 'ORPHAN_RECONCILE_DISABLED' },
      'Vast host-intel orphan reconciliation disabled',
    );
    return;
  }

  const bootDelayMs = Number(process.env.VAST_HOST_INTEL_ORPHAN_BOOT_DELAY_MS ?? 20_000);
  const bootTimer = setTimeout(() => {
    void kickVastHostIntelOrphanReconciliation({ reason: 'startup' });
  }, Number.isFinite(bootDelayMs) && bootDelayMs >= 0 ? bootDelayMs : 20_000);
  if (typeof bootTimer.unref === 'function') bootTimer.unref();

  if (intervalHandle) return;
  const intervalMs = resolveIntervalMs();
  if (intervalMs <= 0) return;

  intervalHandle = setInterval(() => {
    void kickVastHostIntelOrphanReconciliation({ reason: 'interval' });
  }, intervalMs);
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();

  logger('app').info(
    {
      operation: 'vast.host_intel_orphan',
      event: 'ORPHAN_RECONCILE_STARTED',
      graceMs: resolveVastHostIntelOrphanGraceMs(),
      intervalMs,
      bootDelayMs,
    },
    'Vast host-intel orphan reconciliation scheduled',
  );
}

/** @internal */
export function resetVastHostIntelOrphanRunnerForTests() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  activePass = null;
}
