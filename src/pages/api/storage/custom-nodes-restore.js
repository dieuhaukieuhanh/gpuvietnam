import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { isR2Configured, createPresignedDownloadUrl } from '@/lib/r2-client';
import { verifyMachineBackupToken, buildUserBackupR2Key, ALLOWED_BACKUP_PREFIXES } from '@/lib/machine-backup-token';
import { listUserBackupR2Objects } from '@/lib/backup-reconcile';
import { WORKSPACE_RESTORE_PREFIXES } from '@/lib/workspace-restore/workspace-restore-config.js';

/**
 * Pre-start restore API for container-side custom_nodes recovery.
 * GET /api/storage/custom-nodes-restore
 * Authorization: Bearer <GPUVIETNAM_BACKUP_TOKEN>
 *
 * Returns presigned download URLs for the user's custom_nodes backup objects
 * so the container can restore them before ComfyUI starts.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!isR2Configured()) {
      return res.status(503).json({ error: 'R2 chưa được cấu hình trên server.' });
    }

    const authHeader = req.headers.authorization ?? '';
    const rawToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!rawToken) {
      return res.status(401).json({ error: 'Thiếu backup token.' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const verified = await verifyMachineBackupToken(supabaseAdmin, rawToken);
    if (!verified) {
      return res.status(401).json({ error: 'Backup token không hợp lệ hoặc đã hết hạn.' });
    }

    const userId = verified.userId;

    // ──────── List custom_nodes objects for this user ────────
    let objects = [];
    try {
      objects = await listUserBackupR2Objects(userId, { maxKeys: 5000 });
    } catch (listErr) {
      console.warn(
        '[custom-nodes-restore] listUserBackupR2Objects failed:',
        listErr instanceof Error ? listErr.message : listErr,
      );
      // Return empty — container will continue without custom nodes
      return res.status(200).json({
        success: true,
        userId,
        objects: [],
        message: 'No custom_nodes backup found (R2 list failed).',
      });
    }

    // Filter to custom_nodes prefix only
    const customNodesObjects = objects.filter((o) => {
      const prefix = String(o.relativeKey).split('/')[0];
      return prefix === 'custom_nodes' && WORKSPACE_RESTORE_PREFIXES.includes(prefix);
    });

    if (customNodesObjects.length === 0) {
      return res.status(200).json({
        success: true,
        userId,
        objects: [],
        message: 'No custom_nodes backup found.',
      });
    }

    // ──────── Generate presigned download URLs ────────
    /** @type {Array<{ relativeKey: string; r2Key: string; downloadUrl: string; sizeBytes: number }>} */
    const downloads = [];
    /** @type {Array<{ relativeKey: string; error: string }>} */
    const errors = [];

    for (const obj of customNodesObjects) {
      try {
        const { downloadUrl } = await createPresignedDownloadUrl(obj.r2Key, {
          expiresIn: 600, // 10 minutes — enough for container download
        });
        downloads.push({
          relativeKey: obj.relativeKey,
          r2Key: obj.r2Key,
          downloadUrl,
          sizeBytes: obj.sizeBytes,
        });
      } catch (err) {
        errors.push({
          relativeKey: obj.relativeKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return res.status(200).json({
      success: true,
      userId,
      objects: downloads,
      errors: errors.length > 0 ? errors : undefined,
      message:
        downloads.length > 0
          ? `Found ${downloads.length} custom_nodes backup objects.`
          : 'Could not generate download URLs for custom_nodes.',
    });
  } catch (err) {
    console.error('[custom-nodes-restore]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Không lấy được dữ liệu custom_nodes restore.',
    });
  }
}