/**
 * M14 — Operational entry for scheduled/admin reconciliation (wiring only).
 */

import { createGpuService } from '../gpu/gpu-service.js';
import { VastProvider } from '../gpu/providers/vast/vast-provider.js';
import { runInfrastructureReconciliation } from './reconciliation.js';
import {
  fetchDriftItems,
  fetchReconciliationRuns,
  persistReconciliationRun,
} from './reconciliation-persist.js';

/** @type {import('../gpu/gpu-service.js').GPUService | null} */
let defaultGpuService = null;

function getGpuService() {
  if (!defaultGpuService) {
    defaultGpuService = createGpuService(new VastProvider());
  }
  return defaultGpuService;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ repair?: boolean; persist?: boolean; limit?: number; now?: string }} [options]
 */
export async function executeReconciliation(supabaseAdmin, options = {}) {
  const repair = Boolean(options.repair);
  const persist = options.persist !== false;
  const log = (event, payload) => console.info(`[reconciliation] ${event}`, payload);

  const result = await runInfrastructureReconciliation(
    supabaseAdmin,
    { gpuService: getGpuService(), log },
    {
      repair,
      limit: options.limit,
      now: options.now,
    },
  );

  let runId = null;
  if (persist) {
    runId = await persistReconciliationRun(supabaseAdmin, result);
  }

  return {
    ...result,
    runId,
    health: {
      status: result.driftCount === 0 ? 'healthy' : repair ? 'repairing' : 'drift_detected',
      driftCount: result.driftCount,
      repair,
    },
  };
}

export { fetchDriftItems, fetchReconciliationRuns };
