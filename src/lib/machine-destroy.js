import { destroyUserMachine } from '@/lib/machines';
import {
  notifyAdminMachineStopped,
  notifyAutoStopIdle,
  notifyAutoStopOutOfCredit,
  notifyUserMachineStopped,
} from '@/lib/user-notifications';

/** @typedef {'user_stop' | 'admin_stop' | 'idle_timeout' | 'out_of_credit'} DestroyReason */

export const DESTROY_REASONS = ['user_stop', 'admin_stop', 'idle_timeout', 'out_of_credit'];

/**
 * @param {Record<string, unknown> | null | undefined} body
 * @returns {DestroyReason}
 */
export function normalizeDestroyReason(body) {
  const reason = typeof body?.reason === 'string' ? body.reason : '';
  if (DESTROY_REASONS.includes(reason)) {
    return /** @type {DestroyReason} */ (reason);
  }
  if (body?.interrupted) {
    return 'out_of_credit';
  }
  return 'user_stop';
}

/**
 * Unified destroy flow (M7): backup → closing → provider destroy → verify → close → settlement → cleanup.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {import('@/lib/gpu/gpu-service').GPUService} gpuService
 * @param {string} userId
 * @param {{
 *   reason?: DestroyReason;
 *   interrupted?: boolean;
 *   skipBilling?: boolean;
 *   skipBackup?: boolean;
 *   notifyBackupStart?: boolean;
 * }} [options]
 */
export async function destroyMachineWithBackup(supabaseAdmin, gpuService, userId, options = {}) {
  const reason = options.reason ?? 'user_stop';
  return destroyUserMachine(supabaseAdmin, gpuService, userId, {
    ...options,
    reason,
  });
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {DestroyReason} reason
 * @param {boolean | null | undefined} backupSuccess
 */
export async function notifyAfterMachineDestroy(supabaseAdmin, userId, reason, backupSuccess) {
  switch (reason) {
    case 'out_of_credit':
      return notifyAutoStopOutOfCredit(supabaseAdmin, { userId, backupSuccess: Boolean(backupSuccess) });
    case 'idle_timeout':
      return notifyAutoStopIdle(supabaseAdmin, { userId, backupSuccess: Boolean(backupSuccess) });
    case 'admin_stop':
      return notifyAdminMachineStopped(supabaseAdmin, { userId, backupSuccess: Boolean(backupSuccess) });
    default:
      return notifyUserMachineStopped(supabaseAdmin, { userId, backupSuccess: Boolean(backupSuccess) });
  }
}
