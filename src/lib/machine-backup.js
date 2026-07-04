import { createBackupLog } from '@/lib/backup-logs';
import {
  isR2Configured,
  uploadToR2,
  downloadFromR2,
} from '@/lib/r2-client';
import {
  isSshConfigured,
  resolveSshTargetFromVast,
  sshExec,
  sshReadFile,
  sshWriteFile,
} from '@/lib/machine-ssh';
import { VastClient } from '@/lib/gpu/providers/vast/vast-client.js';

/** @type {Array<{ name: string; sourcePath: string; destPrefix: string; incremental?: boolean }>} */
const BACKUP_TARGETS = [
  {
    name: 'outputs',
    sourcePath: '/app/ComfyUI/output',
    destPrefix: 'outputs',
  },
  {
    name: 'workflows',
    sourcePath: '/app/ComfyUI/user/default/workflows',
    destPrefix: 'workflows',
  },
  {
    name: 'models',
    sourcePath: '/app/ComfyUI/models',
    destPrefix: 'models',
    incremental: true,
  },
];

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} machine
 * @param {string} userId
 * @param {string} reason
 */
export async function backupBeforeStop(supabaseAdmin, machine, userId, reason) {
  if (!isR2Configured() || !isSshConfigured()) {
    await createBackupLog(supabaseAdmin, {
      userId,
      machineId: String(machine.id),
      reason,
      status: 'failed',
      errorMessage: 'Chưa cấu hình R2 hoặc SSH (VAST_SSH_PRIVATE_KEY).',
    });
    return false;
  }

  const instanceId = String(machine.instance_id ?? '');
  if (!instanceId) {
    await createBackupLog(supabaseAdmin, {
      userId,
      machineId: String(machine.id),
      reason,
      status: 'failed',
      errorMessage: 'Thiếu instance_id.',
    });
    return false;
  }

  let vastInstance;
  try {
    const client = new VastClient();
    vastInstance = await client.getInstance(instanceId);
  } catch (error) {
    await createBackupLog(supabaseAdmin, {
      userId,
      machineId: String(machine.id),
      reason,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  const sshTarget = resolveSshTargetFromVast(vastInstance);
  if (!sshTarget) {
    await createBackupLog(supabaseAdmin, {
      userId,
      machineId: String(machine.id),
      reason,
      status: 'failed',
      errorMessage: 'Không lấy được thông tin SSH của máy.',
    });
    return false;
  }

  /** @type {Array<Record<string, unknown>>} */
  const archives = [];
  let totalBytes = 0;
  /** @type {string[]} */
  const errors = [];

  for (const target of BACKUP_TARGETS) {
    try {
      const archive = await backupFolder(sshTarget, userId, target);
      if (archive) {
        archives.push(archive);
        totalBytes += Number(archive.sizeBytes ?? 0);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[machine-backup] ${target.name}:`, message);
      errors.push(`${target.name}: ${message}`);
    }
  }

  const status =
    archives.length === 0 && errors.length > 0
      ? 'failed'
      : errors.length > 0
        ? 'partial'
        : 'completed';

  await createBackupLog(supabaseAdmin, {
    userId,
    machineId: String(machine.id),
    reason,
    status,
    errorMessage: errors.length > 0 ? errors.join(' | ') : null,
    sizeBytes: totalBytes,
    archives,
  });

  return status === 'completed' || (status === 'partial' && archives.length > 0);
}

/**
 * @param {{ host: string; port?: number; username?: string }} sshTarget
 * @param {string} userId
 * @param {{ name: string; sourcePath: string; destPrefix: string; incremental?: boolean }} target
 */
async function backupFolder(sshTarget, userId, target) {
  const existsCheck = await sshExec(
    sshTarget,
    `test -d "${target.sourcePath}" && find "${target.sourcePath}" -type f | head -1`,
  );

  if (!existsCheck.stdout.trim()) {
    if (target.incremental) return null;
    return null;
  }

  if (target.incremental) {
    const recentCheck = await sshExec(
      sshTarget,
      `find "${target.sourcePath}" -type f -mtime -7 | head -1`,
    );
    if (!recentCheck.stdout.trim()) {
      return null;
    }
  }

  const archiveName = `${Date.now()}-${target.name}.tar.gz`;
  const remoteArchive = `/tmp/${archiveName}`;

  await sshExec(
    sshTarget,
    `mkdir -p /tmp && tar -czf "${remoteArchive}" -C "${target.sourcePath}" .`,
  );

  const fileContent = await sshReadFile(sshTarget, remoteArchive);
  await sshExec(sshTarget, `rm -f "${remoteArchive}"`);

  if (!fileContent.length) {
    return null;
  }

  const r2Key = `users/${userId}/${target.destPrefix}/${archiveName}`;
  await uploadToR2(r2Key, fileContent);

  return {
    folder: target.name,
    sourcePath: target.sourcePath,
    r2Key,
    sizeBytes: fileContent.length,
    archiveName,
  };
}

/**
 * @param {{ host: string; port?: number; username?: string }} sshTarget
 * @param {Record<string, unknown>} archive
 */
async function restoreArchive(sshTarget, archive) {
  const r2Key = String(archive.r2Key ?? '');
  const sourcePath = String(archive.sourcePath ?? '');
  if (!r2Key || !sourcePath) {
    throw new Error('Backup archive thiếu thông tin khôi phục.');
  }

  const content = await downloadFromR2(r2Key);
  const remoteArchive = `/tmp/restore-${Date.now()}.tar.gz`;

  await sshWriteFile(sshTarget, content, remoteArchive);
  await sshExec(sshTarget, `mkdir -p "${sourcePath}" && tar -xzf "${remoteArchive}" -C "${sourcePath}"`);
  await sshExec(sshTarget, `rm -f "${remoteArchive}"`);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {Record<string, unknown>} backupLog
 * @param {Record<string, unknown>} machine
 */
export async function restoreBackupToMachine(supabaseAdmin, userId, backupLog, machine) {
  if (backupLog.status === 'failed') {
    throw new Error('Bản backup này thất bại, không thể khôi phục.');
  }

  const archives = Array.isArray(backupLog.archives) ? backupLog.archives : [];
  if (archives.length === 0) {
    throw new Error('Bản backup không có dữ liệu.');
  }

  if (!isR2Configured() || !isSshConfigured()) {
    throw new Error('Chưa cấu hình R2 hoặc SSH.');
  }

  const instanceId = String(machine.instance_id ?? '');
  const client = new VastClient();
  const vastInstance = await client.getInstance(instanceId);
  const sshTarget = resolveSshTargetFromVast(vastInstance);

  if (!sshTarget) {
    throw new Error('Không kết nối được SSH tới máy đang chạy.');
  }

  /** @type {string[]} */
  const errors = [];

  for (const archive of archives) {
    try {
      await restoreArchive(sshTarget, archive);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (errors.length === archives.length) {
    throw new Error(errors[0] ?? 'Khôi phục thất bại.');
  }

  return {
    restored: archives.length - errors.length,
    total: archives.length,
    errors,
  };
}
