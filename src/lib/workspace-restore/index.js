import { classifyUserWorkspace } from './workspace-restore-classify.js';
import { restoreWorkspaceLevel1 } from './workspace-restore-run.js';
import { WORKSPACE_RESTORE_TICK } from './workspace-restore-config.js';
import { setProvisionProgress, PROVISION_STAGE } from '../provision-progress/index.js';
import { isAutoBackupEnabledForUser } from '../backup-auto-policy.js';
import { isR2Configured } from '../r2-client.js';
import { insertBootEvent } from '../runtime-boot-event-server.js';

/**
 * After Comfy is ready: classify and either auto-restore, prompt, or skip.
 * Best-effort — never throws to caller (provision already succeeded).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   userId: string;
 *   subscriptionId: string;
 *   machine: Record<string, unknown>;
 *   requestId?: string | null;
 * }} params
 */
export async function maybeSmartRestoreAfterReady(supabaseAdmin, params) {
  const { userId, subscriptionId, machine, requestId = null } = params;

  const setTick = async (tick, message) => {
    try {
      await setProvisionProgress(subscriptionId, {
        stage: PROVISION_STAGE.RUNNING,
        tick,
        message,
        requestId,
        supabaseAdmin,
      });
    } catch (err) {
      console.warn(
        '[workspace-restore] setProvisionProgress failed:',
        err instanceof Error ? err.message : err,
      );
    }
  };

  try {
    if (!isR2Configured()) {
      await setTick(WORKSPACE_RESTORE_TICK.SKIPPED, 'Bỏ qua Workspace restore (chưa cấu hình R2)');
      return { action: 'skipped', reason: 'r2_not_configured' };
    }

    let autoOn = true;
    try {
      autoOn = await isAutoBackupEnabledForUser(supabaseAdmin, userId, null);
    } catch {
      /* continue */
    }
    if (!autoOn) {
      await setTick(WORKSPACE_RESTORE_TICK.SKIPPED, 'Bỏ qua Workspace restore (Auto Backup tắt)');
      return { action: 'skipped', reason: 'auto_backup_off' };
    }

    const classification = await classifyUserWorkspace(userId);
    if (classification.mode === 'empty') {
      await setTick(WORKSPACE_RESTORE_TICK.READY, 'Workspace sẵn sàng');
      return { action: 'empty', classification };
    }

    if (classification.mode === 'choice') {
      await setTick(
        WORKSPACE_RESTORE_TICK.CHOICE,
        'Có thể khôi phục Workspace từ phiên trước',
      );
      return { action: 'choice', classification };
    }

    // mode === 'auto'
    await setTick(WORKSPACE_RESTORE_TICK.RESTORING, 'Đang khôi phục Workspace...');

    // Record pre_restore_started boot event
    const machineId = typeof machine.id === 'string' ? machine.id : null;
    if (machineId) {
      await insertBootEvent(supabaseAdmin, {
        machineId,
        stage: 'pre_restore_started',
        idempotencyKey: 'pre_restore_started',
      });
    }

    const result = await restoreWorkspaceLevel1(supabaseAdmin, userId, machine);

    // Record pre_restore_complete boot event
    if (machineId) {
      await insertBootEvent(supabaseAdmin, {
        machineId,
        stage: 'pre_restore_complete',
        idempotencyKey: 'pre_restore_complete',
        payload: {
          restored: result.restored ?? 0,
          failed: result.failed ?? 0,
          total: result.total ?? 0,
        },
      });
    }

    const failedAll = result.restored === 0 && result.total > 0 && result.errors?.length;
    if (failedAll) {
      await setTick(
        WORKSPACE_RESTORE_TICK.FAILED,
        'Khôi phục Workspace thất bại — vẫn vào được ComfyUI',
      );
      return { action: 'failed', classification, result };
    }
    await setTick(WORKSPACE_RESTORE_TICK.READY, 'Workspace sẵn sàng');
    return { action: 'restored', classification, result };
  } catch (err) {
    console.error('[workspace-restore] maybeSmartRestoreAfterReady:', err);
    await setTick(
      WORKSPACE_RESTORE_TICK.FAILED,
      'Khôi phục Workspace thất bại — vẫn vào được ComfyUI',
    );
    return { action: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

export { classifyUserWorkspace } from './workspace-restore-classify.js';
export { restoreWorkspaceLevel1 } from './workspace-restore-run.js';
export {
  WORKSPACE_RESTORE_TICK,
  WORKSPACE_RESTORE_PREFIXES,
  resolveWorkspaceRestoreSmallBytes,
} from './workspace-restore-config.js';
