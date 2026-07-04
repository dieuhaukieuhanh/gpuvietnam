import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getGpuService } from '@/lib/gpu';
import { mapDestroyApiResponse } from '@/lib/gpu/api-scb';
import { destroyMachineWithBackup, notifyAfterMachineDestroy } from '@/lib/machine-destroy';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();
    const gpuService = getGpuService();
    const result = await destroyMachineWithBackup(supabaseAdmin, gpuService, user.id, {
      reason: 'user_stop',
    });

    if (!result.destroyed) {
      return res.status(404).json({ error: 'Không tìm thấy máy để tắt.' });
    }

    await notifyAfterMachineDestroy(supabaseAdmin, user.id, 'user_stop', result.backupSuccess);

    return res.status(200).json({
      message: 'Đã tắt máy.',
      ...mapDestroyApiResponse(result),
    });
  } catch (err) {
    console.error('[user/stop-machine]', err);
    return res.status(500).json({ error: err.message || 'Không tắt được máy.' });
  }
}
