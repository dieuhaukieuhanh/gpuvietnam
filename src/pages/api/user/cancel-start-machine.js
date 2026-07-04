import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getGpuService, interruptPendingSessionForUser } from '@/lib/gpu';
import { destroyMachineWithBackup } from '@/lib/machine-destroy';
import {
  getActiveMachineForUser,
  resetProvisioningSubscription,
  updateSubscriptionServerStatus,
} from '@/lib/machines';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();

    const { data: subscription, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('id, server_status')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subError) throw subError;
    if (!subscription) {
      return res.status(404).json({ error: 'Không tìm thấy gói để hủy khởi động.' });
    }

    if (subscription.server_status !== 'provisioning') {
      const activeMachine = await getActiveMachineForUser(supabaseAdmin, user.id);
      const booting =
        activeMachine &&
        ['creating', 'starting'].includes(String(activeMachine.status ?? ''));

      if (!booting) {
        return res.status(400).json({ error: 'Máy không ở trạng thái đang khởi động.' });
      }
    }

    const gpuService = getGpuService();
    const interruptResult = await interruptPendingSessionForUser(supabaseAdmin, user.id);
    await destroyMachineWithBackup(supabaseAdmin, gpuService, user.id, {
      interrupted: true,
      reason: 'user_stop',
    });
    await resetProvisioningSubscription(supabaseAdmin, user.id);
    await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');

    return res.status(200).json({
      success: true,
      message: 'Đã hủy khởi động.',
      sessionStatus: interruptResult.sessionStatus ?? null,
      settlementStatus: interruptResult.settlementStatus ?? null,
    });
  } catch (err) {
    console.error('[user/cancel-start-machine]', err);
    return res.status(500).json({ error: err.message || 'Không hủy được khởi động.' });
  }
}
