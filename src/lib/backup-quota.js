import { getUserStorageUsage, planBytes } from './storage-plans.js';

/**
 * Backup quota for periodic + stop layers.
 * Policy (C11): when over quota, reject models; still allow outputs/workflows (crash protection).
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function getBackupQuotaStatus(supabaseAdmin, userId) {
  const { data: profile, error } = await supabaseAdmin
    .from('users')
    .select('backup_plan_gb')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;

  const planGb = Math.max(1, Number(profile?.backup_plan_gb ?? 100) || 100);
  const { backupUsed } = await getUserStorageUsage(supabaseAdmin, userId);
  const limitBytes = planBytes(planGb);
  const remainingBytes = Math.max(0, limitBytes - backupUsed);
  const overQuota = backupUsed >= limitBytes;

  return {
    planGb,
    usedBytes: backupUsed,
    limitBytes,
    remainingBytes,
    overQuota,
    skipModels: overQuota,
  };
}

/**
 * @param {string} relativeKey outputs/... | workflows/... | models/...
 * @param {{ overQuota?: boolean; skipModels?: boolean }} status
 * @param {{ sizeBytes?: number; remainingBytes?: number }} [opts]
 */
export function evaluateBackupKeyAgainstQuota(relativeKey, status, opts = {}) {
  const key = String(relativeKey ?? '');
  const prefix = key.split('/')[0];
  const sizeBytes = Math.max(0, Math.floor(Number(opts.sizeBytes ?? 0) || 0));

  if (prefix === 'models' && (status.skipModels || status.overQuota)) {
    return {
      ok: false,
      error: 'Đã hết dung lượng Backup — tạm bỏ models; outputs/workflows vẫn được phép.',
    };
  }

  if (sizeBytes > 0 && opts.remainingBytes != null) {
    const remaining = Math.max(0, Math.floor(Number(opts.remainingBytes) || 0));
    if (prefix === 'models' && sizeBytes > remaining) {
      return {
        ok: false,
        error: `File models vượt phần dung lượng còn lại (${remaining} bytes).`,
      };
    }
  }

  return { ok: true };
}

/**
 * Category for storage_files from relative backup key.
 * @param {string} relativeKey
 */
export function backupKeyCategory(relativeKey) {
  const prefix = String(relativeKey ?? '').split('/')[0];
  if (prefix === 'workflows') return 'workflow';
  if (prefix === 'models') return 'model';
  if (prefix === 'settings') return 'settings';
  if (prefix === 'custom_nodes') return 'custom_node';
  return 'output';
}
