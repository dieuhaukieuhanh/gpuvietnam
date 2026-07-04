import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getAdminUserFromRequest, isAdminSecretValid } from '@/lib/admin-auth';
import { getGpuService } from '@/lib/gpu';
import { mapDestroyApiResponse } from '@/lib/gpu/api-scb';
import {
  destroyMachineWithBackup,
  normalizeDestroyReason,
  notifyAfterMachineDestroy,
} from '@/lib/machine-destroy';
import { resetProvisioningSubscription } from '@/lib/machines';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const gpuService = getGpuService();

    const adminUser = await getAdminUserFromRequest(req);
    const isAdmin = Boolean(adminUser) || isAdminSecretValid(req);
    const bodyUserId = typeof req.body?.userId === 'string' ? req.body.userId : null;

    let targetUserId;
    let reason;

    if (isAdmin && bodyUserId) {
      targetUserId = bodyUserId;
      reason = normalizeDestroyReason({ ...req.body, reason: req.body?.reason ?? 'admin_stop' });
    } else {
      const user = await getAuthUserFromRequest(req);
      if (!user) return unauthorized(res);
      if (bodyUserId && bodyUserId !== user.id) {
        return res.status(403).json({ error: 'Không có quyền tắt máy người khác.' });
      }
      targetUserId = user.id;
      reason = normalizeDestroyReason(req.body);
    }

    const interrupted = Boolean(req.body?.interrupted);
    const result = await destroyMachineWithBackup(supabaseAdmin, gpuService, targetUserId, {
      interrupted,
      reason,
    });

    if (!result.destroyed) {
      const reset = await resetProvisioningSubscription(supabaseAdmin, targetUserId);
      if (reset.reset) {
        return res.status(200).json({
          success: true,
          message: 'Đã hủy trạng thái khởi động — máy chưa bật.',
          reason,
        });
      }
      return res.status(404).json({ error: 'Không tìm thấy máy để tắt.' });
    }

    await notifyAfterMachineDestroy(
      supabaseAdmin,
      targetUserId,
      reason,
      result.backupSuccess,
    );

    const destroyPayload = mapDestroyApiResponse(result);

    const backupMessage =
      result.backupSuccess === true
        ? ' Dữ liệu đã được backup.'
        : result.backupSuccess === false
          ? ' Backup thất bại — vui lòng kiểm tra tab Bộ nhớ.'
          : '';

    return res.status(200).json({
      message: `Đã tắt máy.${backupMessage}`,
      ...destroyPayload,
    });
  } catch (err) {
    console.error('[machines/destroy]', err);
    return res.status(500).json({ error: err.message || 'Không tắt được máy.' });
  }
}
