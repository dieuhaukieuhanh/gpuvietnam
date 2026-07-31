import { listRecentBackupLogs } from '../backup-logs.js';
import { listUserBackupR2Objects } from '../backup-reconcile.js';
import { isR2Configured, downloadFromR2 } from '../r2-client.js';
import {
  resolveBackupSshTarget,
  restoreBackupToMachine,
} from '../machine-backup.js';
import { sshExec, sshWriteFile } from '../machine-ssh.js';
import {
  WORKSPACE_RESTORE_DEST,
  WORKSPACE_RESTORE_MAX_FILES,
  WORKSPACE_RESTORE_PREFIXES,
} from './workspace-restore-config.js';

/**
 * Latest completed/partial stop-backup log with restoreable archives.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function findLatestRestoreableBackupLog(supabaseAdmin, userId) {
  const logs = await listRecentBackupLogs(supabaseAdmin, userId, { limit: 10 });
  for (const log of logs) {
    if (log.status === 'failed' || log.status === 'skipped') continue;
    const archives = Array.isArray(log.archives) ? log.archives : [];
    const usable = archives.filter((a) => {
      const folder = String(a.folder ?? a.destPrefix ?? '');
      const r2Key = String(a.r2Key ?? '');
      const sourcePath = String(a.sourcePath ?? '');
      return (
        r2Key &&
        sourcePath &&
        WORKSPACE_RESTORE_PREFIXES.includes(folder)
      );
    });
    if (usable.length > 0) {
      return { ...log, archives: usable };
    }
  }
  return null;
}

/**
 * Restore Level-1 prefixes from a backup log (archives filtered).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {Record<string, unknown>} machine
 * @param {Record<string, unknown>} backupLog
 */
export async function restoreFromBackupLog(supabaseAdmin, userId, machine, backupLog) {
  const archives = (Array.isArray(backupLog.archives) ? backupLog.archives : []).filter((a) =>
    WORKSPACE_RESTORE_PREFIXES.includes(String(a.folder ?? '')),
  );
  if (!archives.length) {
    return { restored: 0, total: 0, errors: [], method: 'backup_log' };
  }
  const result = await restoreBackupToMachine(supabaseAdmin, userId, { ...backupLog, archives }, machine);
  return { ...result, method: 'backup_log' };
}

/**
 * Fallback: copy individual R2 objects under workflows|outputs|settings onto the machine.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {Record<string, unknown>} machine
 */
export async function restoreFromR2Files(supabaseAdmin, userId, machine) {
  if (!isR2Configured()) {
    throw new Error('Chưa cấu hình R2.');
  }

  const sshTarget = await resolveBackupSshTarget(machine);
  if (!sshTarget) {
    // Container-side restore (restore-environment.sh via HTTP API) handles
    // restore before ComfyUI starts. SSH-less providers like Vast skip this
    // second server-side pass gracefully — workspace is already restored.
    console.info('[workspace-restore] SSH not available — container-side restore already ran');
    return { restored: 0, total: 0, errors: [], method: 'r2_files_skipped_no_ssh' };
  }

  const objects = await listUserBackupR2Objects(userId, { maxKeys: 5000 });
  const candidates = objects
    .filter((o) => {
      const prefix = String(o.relativeKey).split('/')[0];
      if (!WORKSPACE_RESTORE_PREFIXES.includes(prefix)) return false;
      // Skip stop-backup tar.gz — handled via backup_logs path when available
      if (String(o.relativeKey).endsWith('.tar.gz')) return false;
      return true;
    })
    .slice(0, WORKSPACE_RESTORE_MAX_FILES);

  /** @type {string[]} */
  const errors = [];
  let restored = 0;

  for (const obj of candidates) {
    const prefix = String(obj.relativeKey).split('/')[0];
    const destRoot = WORKSPACE_RESTORE_DEST[prefix];
    if (!destRoot) continue;
    const relRest = obj.relativeKey.slice(prefix.length + 1);
    if (!relRest || relRest.includes('..')) continue;
    const remotePath = `${destRoot}/${relRest}`.replace(/\/+/g, '/');
    try {
      const content = await downloadFromR2(obj.r2Key);
      const dir = remotePath.includes('/') ? remotePath.slice(0, remotePath.lastIndexOf('/')) : destRoot;
      await sshExec(sshTarget, `mkdir -p "${dir}"`);
      await sshWriteFile(sshTarget, content, remotePath);
      restored += 1;
    } catch (err) {
      errors.push(
        `${obj.relativeKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    restored,
    total: candidates.length,
    errors,
    method: 'r2_files',
  };
}

/**
 * Full Level-1 restore: prefer stop archives, else R2 files.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {Record<string, unknown>} machine
 */
export async function restoreWorkspaceLevel1(supabaseAdmin, userId, machine) {
  const log = await findLatestRestoreableBackupLog(supabaseAdmin, userId);
  if (log) {
    try {
      const fromLog = await restoreFromBackupLog(supabaseAdmin, userId, machine, log);
      if (fromLog.restored > 0) return { ...fromLog, backupLogId: log.id };
    } catch (err) {
      console.warn(
        '[workspace-restore] backup_log restore failed, falling back to R2 files:',
        err instanceof Error ? err.message : err,
      );
    }
  }
  return restoreFromR2Files(supabaseAdmin, userId, machine);
}
