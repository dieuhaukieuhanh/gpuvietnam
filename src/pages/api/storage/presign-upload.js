import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { isR2Configured, createPresignedUploadUrls } from '@/lib/r2-client';
import { verifyMachineBackupToken, hashBackupToken, sanitizeBackupObjectKey } from '@/lib/machine-backup-token';
import {
  evaluateBackupKeyAgainstQuota,
  getBackupQuotaStatus,
} from '@/lib/backup-quota';
import { checkBackupPresignRateLimit } from '@/lib/backup-presign-rate-limit';

/**
 * Container backup auth: Bearer <machine backup token> (not full user JWT).
 * POST { objects: [{ key, contentType?, sizeBytes? }], expiresIn? }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
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

    const rate = checkBackupPresignRateLimit(hashBackupToken(rawToken));
    if (!rate.ok) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      return res.status(429).json({
        error: 'Quá nhiều yêu cầu presign. Thử lại sau.',
        retryAfterSec: rate.retryAfterSec,
      });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const verified = await verifyMachineBackupToken(supabaseAdmin, rawToken);
    if (!verified) {
      return res.status(401).json({ error: 'Backup token không hợp lệ hoặc đã hết hạn.' });
    }

    const body = req.body ?? {};
    const objects = Array.isArray(body.objects) ? body.objects : [];
    if (objects.length === 0) {
      return res.status(400).json({ error: 'Cần objects: [{ key, contentType? }].' });
    }
    if (objects.length > 50) {
      return res.status(400).json({ error: 'Tối đa 50 objects mỗi request.' });
    }

    const quota = await getBackupQuotaStatus(supabaseAdmin, verified.userId);

    /** @type {Array<{ key: string; contentType?: string }>} */
    const allowed = [];
    /** @type {Array<{ key: string; error: string }>} */
    const quotaErrors = [];

    for (const item of objects) {
      const rawKey = item?.key != null ? String(item.key) : '';
      const sanitized = sanitizeBackupObjectKey(rawKey);
      if (!sanitized.ok) {
        quotaErrors.push({ key: rawKey || '(empty)', error: sanitized.error });
        continue;
      }
      const sizeBytes = Math.max(0, Math.floor(Number(item?.sizeBytes ?? 0) || 0));
      const decision = evaluateBackupKeyAgainstQuota(sanitized.key, quota, {
        sizeBytes,
        remainingBytes: quota.remainingBytes,
      });
      if (!decision.ok) {
        quotaErrors.push({ key: sanitized.key, error: decision.error });
        continue;
      }
      allowed.push({
        key: sanitized.key,
        contentType: item?.contentType,
      });
    }

    if (allowed.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Không có object nào được phép upload (quota hoặc key không hợp lệ).',
        errors: quotaErrors,
        quota: {
          planGb: quota.planGb,
          usedBytes: quota.usedBytes,
          remainingBytes: quota.remainingBytes,
          overQuota: quota.overQuota,
          skipModels: quota.skipModels,
        },
      });
    }

    const result = await createPresignedUploadUrls(verified.userId, allowed, {
      expiresIn: body.expiresIn,
    });

    return res.status(200).json({
      success: true,
      userId: verified.userId,
      machineId: verified.machineId,
      expiresIn: result.expiresIn,
      uploads: result.uploads,
      errors: [...quotaErrors, ...(result.errors || [])],
      quota: {
        planGb: quota.planGb,
        usedBytes: quota.usedBytes,
        remainingBytes: quota.remainingBytes,
        overQuota: quota.overQuota,
        skipModels: quota.skipModels,
      },
    });
  } catch (err) {
    console.error('[storage/presign-upload]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Không tạo được presigned URL.',
    });
  }
}
