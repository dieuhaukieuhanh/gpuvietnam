import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import {
  getGpuService,
  interruptPendingSessionForUser,
  snapshotToMachineRecord,
  resolveMachineSessionView,
  persistDestroyCompleted,
  requestCancelMachine,
} from '@/lib/gpu';
import { destroyMachineWithBackup } from '@/lib/machine-destroy';
import { getActiveMachineForUser } from '@/lib/machines';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { deriveSessionPhase } from '@/lib/gpu/machine-lifecycle';
import { resolveBillingViewForCommand } from '@/lib/gpu/billing-session-view';

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
      .select('id, server_status, env_name, status')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subError) throw subError;
    if (!subscription) {
      return res.status(404).json({ error: 'Không tìm thấy gói để hủy khởi động.' });
    }

    const activeMachine = await getActiveMachineForUser(supabaseAdmin, user.id);
    let machineRecord = snapshotToMachineRecord(subscription, activeMachine, user.id);
    const phase = deriveSessionPhase(machineRecord);

    if (phase !== 'opening') {
      return res.status(400).json({ error: 'Máy không ở trạng thái đang khởi động.' });
    }

    const lifecycleCtx = {
      subscriptionActive: subscription.status === 'active',
      providerDestroyedVerified: true,
    };

    if (machineRecord) {
      const cancelResult = requestCancelMachine(machineRecord, lifecycleCtx);
      if (cancelResult.machine) machineRecord = cancelResult.machine;
    }

    const gpuService = getGpuService();
    const interruptResult = await interruptPendingSessionForUser(supabaseAdmin, user.id);
    await destroyMachineWithBackup(supabaseAdmin, gpuService, user.id, {
      interrupted: true,
      reason: 'user_stop',
    });

    if (machineRecord) {
      await persistDestroyCompleted(supabaseAdmin, subscription.id, machineRecord, lifecycleCtx);
    }

    const machineSessionView = resolveMachineSessionView(
      snapshotToMachineRecord({ ...subscription, server_status: 'offline' }, null, user.id),
      { envName: subscription.env_name ?? null },
    );

    const billingView = await resolveBillingViewForCommand(supabaseAdmin, user.id, {
      machineSessionView,
      machine: null,
      gpuService,
    });

    return res.status(200).json({
      success: true,
      message: 'Đã hủy khởi động.',
      sessionStatus: interruptResult.sessionStatus ?? null,
      settlementStatus: interruptResult.settlementStatus ?? null,
      machineSessionView,
      billingView,
    });
  } catch (err) {
    console.error('[user/cancel-start-machine]', err);
    return res.status(500).json({ error: err.message || 'Không hủy được khởi động.' });
  }
}
