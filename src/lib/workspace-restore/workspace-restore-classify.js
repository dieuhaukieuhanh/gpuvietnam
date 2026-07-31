import { listUserBackupR2Objects } from '../backup-reconcile.js';
import { isR2Configured } from '../r2-client.js';
import {
  WORKSPACE_RESTORE_PREFIXES,
  resolveWorkspaceRestoreSmallBytes,
} from './workspace-restore-config.js';

/**
 * @param {string} relativeKey
 */
function prefixOf(relativeKey) {
  return String(relativeKey ?? '').split('/')[0];
}

/**
 * Classify Level-1 workspace size on R2 (workflows + outputs + settings).
 * @param {string} userId
 * @returns {Promise<{
 *   mode: 'empty' | 'auto' | 'choice';
 *   totalBytes: number;
 *   fileCount: number;
 *   byPrefix: Record<string, { bytes: number; count: number }>;
 *   thresholdBytes: number;
 * }>}
 */
export async function classifyUserWorkspace(userId) {
  const thresholdBytes = resolveWorkspaceRestoreSmallBytes();
  /** @type {Record<string, { bytes: number; count: number }>} */
  const byPrefix = {};
  for (const p of WORKSPACE_RESTORE_PREFIXES) {
    byPrefix[p] = { bytes: 0, count: 0 };
  }

  if (!isR2Configured()) {
    return {
      mode: 'empty',
      totalBytes: 0,
      fileCount: 0,
      byPrefix,
      thresholdBytes,
    };
  }

  let objects = [];
  try {
    objects = await listUserBackupR2Objects(userId, { maxKeys: 5000 });
  } catch {
    return {
      mode: 'empty',
      totalBytes: 0,
      fileCount: 0,
      byPrefix,
      thresholdBytes,
    };
  }

  let totalBytes = 0;
  let fileCount = 0;
  for (const obj of objects) {
    const prefix = prefixOf(obj.relativeKey);
    if (!WORKSPACE_RESTORE_PREFIXES.includes(prefix)) continue;
    // Prefer live files over stop tar.gz for size signal when both exist;
    // still count archives toward threshold (large = choice).
    const size = Number(obj.sizeBytes ?? 0) || 0;
    byPrefix[prefix].bytes += size;
    byPrefix[prefix].count += 1;
    totalBytes += size;
    fileCount += 1;
  }

  if (fileCount === 0 || totalBytes === 0) {
    return { mode: 'empty', totalBytes: 0, fileCount: 0, byPrefix, thresholdBytes };
  }
  // Always auto-restore — video creators need heavy custom nodes (Wan2.1,
  // Hunyuan, AnimateDiff) restored without manual choice on every boot.
  return { mode: 'auto', totalBytes, fileCount, byPrefix, thresholdBytes };
}
