import { createBackupLog } from '@/lib/backup-logs';
import {
  isR2Configured,
  uploadToR2,
  downloadFromR2,
} from '@/lib/r2-client';
import { reconcileUserBackupFromR2 } from '@/lib/backup-reconcile';
import {
  isSshKeyConfigured,
  resolveSshTargetFromVast,
  resolveSshTargetFromClore,
  sshExec,
  sshReadFile,
  sshWriteFile,
} from '@/lib/machine-ssh';
import { VastClient } from '@/lib/gpu/providers/vast/vast-client.js';
import { CloreClient } from '@/lib/gpu/providers/clore/clore-client.js';
import {
  resolveFlushSecretFromMachine,
  resolveFlushBaseUrlFromMachine,
  resolveCloreFlushBaseUrl,
  requestContainerBackupFlush,
} from '@/lib/machine-backup-http-flush.js';
import { isAutoBackupEnabledForUser } from '@/lib/backup-auto-policy.js';

/**
 * Backup layers (C9):
 * - Periodic (in-container): crash protection while running — individual files via presign.
 * - Stop-backup (this module): final SSH archive checkpoint + backup_logs before destroy.
 * Both write under users/{userId}/(outputs|workflows|models)/; stop then reconciles R2 → storage_files.
 */

/** @type {Array<{ name: string; sourcePath: string; destPrefix: string; category: string; incremental?: boolean }>} */
const BACKUP_TARGETS = [
  {
    name: 'outputs',
    sourcePath: '/app/ComfyUI/output',
    destPrefix: 'outputs',
    category: 'output',
  },
  {
    name: 'workflows',
    sourcePath: '/app/ComfyUI/user/default/workflows',
    destPrefix: 'workflows',
    category: 'workflow',
  },
  {
    name: 'settings',
    sourcePath: '/app/ComfyUI/user/default',
    destPrefix: 'settings',
    category: 'settings',
    tarEntries: ['comfy.settings.json'],
  },
  {
    name: 'models',
    sourcePath: '/app/ComfyUI/models',
    destPrefix: 'models',
    category: 'model',
    incremental: true,
  },
];

/**
 * @param {Record<string, unknown>} machine
 */
function resolveMachineProvider(machine) {
  const raw = String(machine?.provider ?? '').toLowerCase();
  if (raw === 'clore' || raw === 'vast') return raw;
  if (String(process.env.GPU_CLORE_ONLY ?? '').toLowerCase() === 'true') return 'clore';
  return raw || 'vast';
}

/**
 * @param {Record<string, unknown>} machine
 * @returns {Promise<{ host: string; port?: number; username?: string; password?: string | null } | null>}
 */
export async function resolveBackupSshTarget(machine) {
  const instanceId = String(machine.instance_id ?? '');
  if (!instanceId) return null;

  const provider = resolveMachineProvider(machine);

  if (provider === 'clore') {
    const client = new CloreClient();
    const order = await client.getOrder(instanceId);
    const password =
      (machine.ssh_password != null && String(machine.ssh_password).trim()) ||
      String(process.env.CLORE_SSH_PASSWORD ?? '').trim() ||
      null;
    if (!password) {
      throw new Error(
        'Thiếu mật khẩu SSH Clore (machines.ssh_password hoặc CLORE_SSH_PASSWORD). Máy cũ cần tắt/bật lại sau khi cấu hình.',
      );
    }
    return resolveSshTargetFromClore(order, { password });
  }

  const client = new VastClient();
  const vastInstance = await client.getInstance(instanceId);
  return resolveSshTargetFromVast(vastInstance);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {Array<Record<string, unknown>>} archives
 */
async function indexBackupArchivesInStorageFiles(supabaseAdmin, userId, archives) {
  if (!archives.length) return;

  const rows = archives.map((archive) => {
    const folder = String(archive.folder ?? 'outputs');
    const archiveName = String(archive.archiveName ?? `${folder}.tar.gz`);
  const category =
      folder === 'workflows'
        ? 'workflow'
        : folder === 'models'
          ? 'model'
          : folder === 'settings'
            ? 'settings'
            : 'output';
    return {
      user_id: userId,
      file_name: archiveName,
      file_path: `${folder}/${archiveName}`,
      file_size_bytes: Number(archive.sizeBytes ?? 0),
      storage_type: 'backup',
      category,
    };
  });

  const { error } = await supabaseAdmin.from('storage_files').insert(rows);
  if (error) {
    console.error('[machine-backup] index storage_files failed:', error.message);
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} machine
 * @param {string} userId
 * @param {string} reason
 */
export async function backupBeforeStop(supabaseAdmin, machine, userId, reason) {
  try {
    const autoOn = await isAutoBackupEnabledForUser(supabaseAdmin, userId, null);
    if (!autoOn) {
      console.info('[machine-backup] skip stop-backup: auto backup disabled by policy', {
        userId,
        machineId: machine?.id,
      });
      await createBackupLog(supabaseAdmin, {
        userId,
        machineId: String(machine.id),
        reason,
        status: 'skipped',
        errorMessage: 'Auto backup disabled by policy (plan / global Starter / user override).',
      });
      return true;
    }
  } catch (policyErr) {
    console.warn(
      '[machine-backup] auto-backup policy check failed; continuing backup:',
      policyErr instanceof Error ? policyErr.message : policyErr,
    );
  }

  if (!isR2Configured()) {
    await createBackupLog(supabaseAdmin, {
      userId,
      machineId: String(machine.id),
      reason,
      status: 'failed',
      errorMessage: 'Chưa cấu hình R2 (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME).',
    });
    return false;
  }

  const provider = resolveMachineProvider(machine);

  // Prefer L2 HTTP flush (same L1 presign path) - avoids fragile Clore SSH from the app host.
  const flushSecret = resolveFlushSecretFromMachine(machine);
  if (flushSecret) {
    try {
      let baseUrl = resolveFlushBaseUrlFromMachine(machine);
      if (!baseUrl && provider === 'clore' && machine.instance_id) {
        baseUrl = await resolveCloreFlushBaseUrl(String(machine.instance_id));
      }
      if (baseUrl) {
        console.info('[machine-backup] L2 HTTP flush', { baseUrl, machineId: machine.id });
        const flush = await requestContainerBackupFlush({
          baseUrl,
          flushSecret,
          // Keep stop-path backup bounded so destroy/cancel can finish before the
          // client/API gives up (default 90s; override with GPUVIETNAM_BACKUP_FLUSH_TIMEOUT_MS).
          timeoutMs: Number(process.env.GPUVIETNAM_BACKUP_FLUSH_TIMEOUT_MS ?? 90_000) || 90_000,
        });
        try {
          const reconciled = await reconcileUserBackupFromR2(supabaseAdmin, userId);
          if (reconciled.ok) {
            console.info(
              `[machine-backup] reconcile R2→storage_files listed=${reconciled.listed} inserted=${reconciled.inserted} updated=${reconciled.updated}`,
            );
          }
        } catch (reconcileErr) {
          console.warn(
            '[machine-backup] reconcile after HTTP flush failed:',
            reconcileErr instanceof Error ? reconcileErr.message : reconcileErr,
          );
        }

        await createBackupLog(supabaseAdmin, {
          userId,
          machineId: String(machine.id),
          reason,
          status: flush.ok ? 'completed' : 'failed',
          errorMessage: flush.ok
            ? null
            : `HTTP flush failed (${flush.status}): ${JSON.stringify(flush.body).slice(0, 500)}`,
          sizeBytes: 0,
          archives: flush.ok ? [{ method: 'http_flush', url: flush.url }] : [],
        });

        if (flush.ok) return true;
        console.warn('[machine-backup] HTTP flush failed; falling back to SSH if available');
      } else {
        console.warn('[machine-backup] HTTP flush skipped: no Comfy base URL');
      }
    } catch (httpErr) {
      console.warn(
        '[machine-backup] HTTP flush error; falling back to SSH:',
        httpErr instanceof Error ? httpErr.message : httpErr,
      );
    }
  }

  const hasClorePassword =
    Boolean(machine.ssh_password && String(machine.ssh_password).trim()) ||
    Boolean(String(process.env.CLORE_SSH_PASSWORD ?? '').trim());
  const sshReady = provider === 'clore' ? hasClorePassword : isSshKeyConfigured();

  if (!sshReady) {
    await createBackupLog(supabaseAdmin, {
      userId,
      machineId: String(machine.id),
      reason,
      status: 'failed',
      errorMessage:
        provider === 'clore'
          ? 'HTTP flush không dùng được và chưa cấu hình SSH Clore (CLORE_SSH_PASSWORD / machines.ssh_password).'
          : 'Chưa cấu hình SSH (VAST_SSH_PRIVATE_KEY).',
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

  /** @type {{ host: string; port?: number; username?: string; password?: string | null } | null} */
  let sshTarget = null;
  try {
    sshTarget = await resolveBackupSshTarget(machine);
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

  if (provider === 'clore' && !sshTarget.password) {
    await createBackupLog(supabaseAdmin, {
      userId,
      machineId: String(machine.id),
      reason,
      status: 'failed',
      errorMessage:
        'Thiếu mật khẩu SSH Clore. Đặt CLORE_SSH_PASSWORD rồi tắt/bật máy để rent lại với mật khẩu đã lưu.',
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

  if (archives.length > 0) {
    await indexBackupArchivesInStorageFiles(supabaseAdmin, userId, archives);
  }

  // C10: sync periodic file objects + archives into Backup panel (best-effort).
  try {
    const reconciled = await reconcileUserBackupFromR2(supabaseAdmin, userId);
    if (reconciled.ok) {
      console.info(
        `[machine-backup] reconcile R2→storage_files listed=${reconciled.listed} inserted=${reconciled.inserted} updated=${reconciled.updated}`,
      );
    }
  } catch (reconcileErr) {
    console.warn(
      '[machine-backup] reconcileUserBackupFromR2 failed:',
      reconcileErr instanceof Error ? reconcileErr.message : reconcileErr,
    );
  }

  return status === 'completed' || (status === 'partial' && archives.length > 0);
}

/**
 * @param {{ host: string; port?: number; username?: string; password?: string | null }} sshTarget
 * @param {string} userId
 * @param {{ name: string; sourcePath: string; destPrefix: string; category: string; incremental?: boolean }} target
 */
async function backupFolder(sshTarget, userId, target) {
  const tarEntries = Array.isArray(target.tarEntries) ? target.tarEntries : null;

  if (tarEntries && tarEntries.length > 0) {
    const listed = tarEntries.map((e) => `"${e}"`).join(' ');
    const existsCheck = await sshExec(
      sshTarget,
      `cd "${target.sourcePath}" && for f in ${listed}; do test -e "$f" && echo ok && break; done`,
    );
    if (!existsCheck.stdout.trim()) {
      return null;
    }
  } else {
    const existsCheck = await sshExec(
      sshTarget,
      `test -d "${target.sourcePath}" && find "${target.sourcePath}" -type f | head -1`,
    );

    if (!existsCheck.stdout.trim()) {
      return null;
    }
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

  if (tarEntries && tarEntries.length > 0) {
    const listed = tarEntries.map((e) => `"${e}"`).join(' ');
    await sshExec(
      sshTarget,
      `mkdir -p /tmp && tar -czf "${remoteArchive}" -C "${target.sourcePath}" ${listed}`,
    );
  } else {
    await sshExec(
      sshTarget,
      `mkdir -p /tmp && tar -czf "${remoteArchive}" -C "${target.sourcePath}" .`,
    );
  }

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
    category: target.category,
  };
}

/**
 * @param {{ host: string; port?: number; username?: string; password?: string | null }} sshTarget
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

  if (!isR2Configured()) {
    throw new Error('Chưa cấu hình R2.');
  }

  const sshTarget = await resolveBackupSshTarget(machine);
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
