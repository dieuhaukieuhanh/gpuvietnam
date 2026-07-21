import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { verifyMachineBackupToken, sanitizeBackupObjectKey } from '@/lib/machine-backup-token';
import { upsertBackupStorageFiles } from '@/lib/backup-reconcile';

/**
 * Container reports successful periodic uploads so Backup panel updates without waiting for stop.
 * POST { files: [{ key, sizeBytes }] }
 * Auth: Bearer backup token.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
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

    const body = req.body ?? {};
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'Cần files: [{ key, sizeBytes }].' });
    }
    if (files.length > 100) {
      return res.status(400).json({ error: 'Tối đa 100 files mỗi request.' });
    }

    /** @type {Array<{ relativeKey: string; sizeBytes: number }>} */
    const entries = [];
    /** @type {Array<{ key: string; error: string }>} */
    const errors = [];

    for (const item of files) {
      const rawKey = item?.key != null ? String(item.key) : '';
      const sanitized = sanitizeBackupObjectKey(rawKey);
      if (!sanitized.ok) {
        errors.push({ key: rawKey || '(empty)', error: sanitized.error });
        continue;
      }
      entries.push({
        relativeKey: sanitized.key,
        sizeBytes: Math.max(0, Math.floor(Number(item?.sizeBytes ?? 0) || 0)),
      });
    }

    const result = await upsertBackupStorageFiles(supabaseAdmin, verified.userId, entries);

    return res.status(200).json({
      success: true,
      userId: verified.userId,
      machineId: verified.machineId,
      inserted: result.inserted,
      updated: result.updated,
      errors,
    });
  } catch (err) {
    console.error('[storage/backup-report]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Không ghi nhận backup được.',
    });
  }
}