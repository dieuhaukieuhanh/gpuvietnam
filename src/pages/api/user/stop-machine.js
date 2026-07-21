import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { DESTROY_PIPELINE_OUTCOME } from '@/lib/destroy-pipeline-core';
import {
  getGpuServiceForMachine,
  snapshotToMachineRecord,
  resolveMachineSessionView,
  persistStopRequested,
  persistDestroyCompleted,
} from '@/lib/gpu';
import { mapDestroyApiResponse } from '@/lib/gpu/api-scb';
import { destroyMachineWithBackup, notifyAfterMachineDestroy } from '@/lib/machine-destroy';
import { getActiveMachineForUser } from '@/lib/machines';
import { resolveBillingViewForCommand } from '@/lib/gpu/billing-session-view';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();

    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('id, server_status, env_name, status')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!subscription) {
      return res.status(404).json({ error: 'Không tìm thấy gói để tắt máy.' });
    }

    const activeMachine = await getActiveMachineForUser(supabaseAdmin, user.id);
    const gpuService = getGpuServiceForMachine(activeMachine);
    let lifecycleRecord = snapshotToMachineRecord(subscription, activeMachine, user.id);
    const lifecycleCtx = { subscriptionActive: subscription.status === 'active', providerDestroyedVerified: true };

    if (lifecycleRecord?.status === 'running') {
      const stopResult = await persistStopRequested(supabaseAdmin, subscription.id, lifecycleRecord, lifecycleCtx);
      if (stopResult.machine) lifecycleRecord = stopResult.machine;
    }

    const result = await destroyMachineWithBackup(supabaseAdmin, gpuService, user.id, {
      reason: 'user_stop',
    });

    if (!result.destroyed) {
      if (result.outcome === DESTROY_PIPELINE_OUTCOME.NO_MACHINE) {
        if (lifecycleRecord) {
          await persistDestroyCompleted(
            supabaseAdmin,
            subscription.id,
            lifecycleRecord,
            lifecycleCtx,
          );
        }
        const machineSessionView = resolveMachineSessionView(
          snapshotToMachineRecord({ ...subscription, server_status: 'offline' }, null, user.id),
          { envName: subscription?.env_name ?? null },
        );
        const billingView = await resolveBillingViewForCommand(supabaseAdmin, user.id, {
          machineSessionView,
          machine: null,
          gpuService,
        });
        return res.status(200).json({
          success: true,
          alreadyStopped: true,
          message: 'Máy đã tắt.',
          machineSessionView,
          billingView,
          ...mapDestroyApiResponse(result),
        });
      }
      return res.status(409).json({
        error:
          'Chưa tắt được máy phía provider. Vui lòng thử lại sau vài giây.',
        retryable: Boolean(result.retryable),
        ...mapDestroyApiResponse(result),
      });
    }

    if (lifecycleRecord) {
      await persistDestroyCompleted(supabaseAdmin, subscription.id, lifecycleRecord, lifecycleCtx);
    }

    const machineSessionView = resolveMachineSessionView(
      snapshotToMachineRecord({ ...subscription, server_status: 'offline' }, null, user.id),
      { envName: subscription?.env_name ?? null },
    );

    const billingView = await resolveBillingViewForCommand(supabaseAdmin, user.id, {
      machineSessionView,
      machine: null,
      gpuService,
    });

    await notifyAfterMachineDestroy(supabaseAdmin, user.id, 'user_stop', result.backupSuccess);

    return res.status(200).json({
      message: 'Đã tắt máy.',
      machineSessionView,
      billingView,
      ...mapDestroyApiResponse(result),
    });
  } catch (err) {
    console.error('[user/stop-machine]', err);
    return res.status(500).json({ error: err.message || 'Không tắt được máy.' });
  }
}
