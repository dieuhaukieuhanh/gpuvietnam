/**
 * Unified Destroy Pipeline — M7 entry (wires production deps).
 * @see docs/SESSION_CENTRIC_BILLING_ARCHITECTURE.md §6.2
 */

import { backupBeforeStop } from '@/lib/machine-backup';
import { notifyBackupStarted } from '@/lib/user-notifications';
import {
  collectSessionMetrics,
  finalizeGpuSession,
  clearMachineBillingFieldsForPipeline,
} from '@/lib/gpu/billing';
import { settleSession, skipSessionSettlement } from '@/lib/gpu/settlement';
import { runDestroyPipeline } from './destroy-pipeline-run.js';

export {
  DESTROY_PIPELINE_VERSION,
  DESTROY_PIPELINE_STEP,
  DESTROY_PIPELINE_OUTCOME,
  mapDestroyedVerifyOutcome,
  isDestroyVerifyRetryable,
  assertSettlementAfterVerify,
} from '@/lib/destroy-pipeline-core';

export { runDestroyPipeline } from './destroy-pipeline-run.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {import('@/lib/gpu/gpu-service').GPUService} gpuService
 * @param {string} userId
 * @param {{
 *   interrupted?: boolean;
 *   skipBilling?: boolean;
 *   reason?: string;
 *   skipBackup?: boolean;
 *   skipMetrics?: boolean;
 *   notifyBackupStart?: boolean;
 * }} [options]
 */
export async function runUnifiedDestroy(supabaseAdmin, gpuService, userId, options = {}) {
  return runDestroyPipeline(
    supabaseAdmin,
    {
      gpuService,
      settle: settleSession,
      skipSettlement: skipSessionSettlement,
      collectSessionMetrics,
      finalizeGpuSession,
      clearMachineBillingFields: clearMachineBillingFieldsForPipeline,
      backupBeforeStop,
      notifyBackupStarted,
    },
    {
      userId,
      reason: options.reason ?? (options.interrupted ? 'out_of_credit' : 'user_stop'),
      skipBackup: options.skipBackup,
      skipBilling: options.skipBilling,
      skipMetrics: options.skipMetrics,
      notifyBackupStart: options.notifyBackupStart,
    },
  );
}
