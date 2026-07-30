import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { isR2Configured, createPresignedDownloadUrl } from '@/lib/r2-client';
import { verifyMachineBackupToken, buildUserBackupR2Key, ALLOWED_BACKUP_PREFIXES } from '@/lib/machine-backup-token';
import { listUserBackupR2Objects } from '@/lib/backup-reconcile';
import { WORKSPACE_RESTORE_PREFIXES } from '@/lib/workspace-restore/workspace-restore-config.js';

/**
 * Pre-start restore API for container-side workspace recovery.
 * GET /api/storage/custom-nodes-restore
 * Authorization: Bearer <GPUVIETNAM_BACKUP_TOKEN>
 *
 * Returns presigned download URLs for the user's workspace backup objects
 * (custom_nodes, workflows, outputs, settings) so the container can restore
 * them before ComfyUI starts.
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

    // ──────── List workspace objects for this user ────────
    let objects = [];
    try {
      objects = await listUserBackupR2Objects(userId, { maxKeys: 5000 });
    } catch (listErr) {
      console.warn(
        '[workspace-restore] listUserBackupR2Objects failed:',
        listErr instanceof Error ? listErr.message : listErr,
      );
      // Return empty — container will continue without workspace restore
      return res.status(200).json({
        success: true,
        userId,
        objects: [],
        message: 'No workspace backup found (R2 list failed).',
      });
    }

    // Filter to supported workspace prefixes only
    const workspaceObjects = objects.filter((o) => {
      const prefix = String(o.relativeKey).split('/')[0];
      return WORKSPACE_RESTORE_PREFIXES.includes(prefix);
    });

    if (workspaceObjects.length === 0) {
      return res.status(200).json({
        success: true,
        userId,
        objects: [],
        message: 'No workspace backup found.',
      });
    }

    // ──────── Generate presigned download URLs ────────
    /** @type {Array<{ relativeKey: string; r2Key: string; downloadUrl: string; sizeBytes: number }>} */
    const downloads = [];
    /** @type {Array<{ relativeKey: string; error: string }>} */
    const errors = [];

    for (const obj of workspaceObjects) {
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
          ? `Found ${downloads.length} workspace backup objects.`
          : 'Could not generate download URLs for workspace backup.',
    });
  } catch (err) {
    console.error('[workspace-restore]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Không lấy được dữ liệu workspace restore.',
    });
  }
}