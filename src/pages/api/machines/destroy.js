import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getAdminUserFromRequest, isAdminSecretValid } from '@/lib/admin-auth';
import { DESTROY_PIPELINE_OUTCOME } from '@/lib/destroy-pipeline-core';
import {
  getGpuService,
  snapshotToMachineRecord,
  resolveMachineSessionView,
  persistStopRequested,
  persistDestroyCompleted,
} from '@/lib/gpu';
import { mapDestroyApiResponse } from '@/lib/gpu/api-scb';
import { resolveBillingSessionView } from '@/lib/gpu/billing-session-view';
import {
  destroyMachineWithBackup,
  normalizeDestroyReason,
  notifyAfterMachineDestroy,
} from '@/lib/machine-destroy';
import { getActiveMachineForUser, resetProvisioningSubscription } from '@/lib/machines';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function buildIdleMachineSessionView(subscription, userId) {
  return resolveMachineSessionView(
    snapshotToMachineRecord(
      subscription ? { ...subscription, server_status: 'offline' } : null,
      null,
      userId,
    ),
    { envName: subscription?.env_name ?? null },
  );
}

function buildStoppingMachineSessionView(subscription, machine, userId) {
  return resolveMachineSessionView(
    snapshotToMachineRecord(
      subscription ? { ...subscription, server_status: 'stopping' } : null,
      machine,
      userId,
    ),
    { envName: subscription?.env_name ?? null },
  );
}

async function completeUserDestroyInBackground(supabaseAdmin, gpuService, params) {
  const { targetUserId, subscription, lifecycleRecord, lifecycleCtx, interrupted, reason } = params;
  try {
    const result = await destroyMachineWithBackup(supabaseAdmin, gpuService, targetUserId, {
      interrupted,
      reason,
    });

    if (lifecycleRecord && subscription) {
      await persistDestroyCompleted(
        supabaseAdmin,
        subscription.id,
        lifecycleRecord,
        lifecycleCtx,
      );
    }

    if (result.destroyed) {
      await notifyAfterMachineDestroy(
        supabaseAdmin,
        targetUserId,
        reason,
        result.backupSuccess,
      );
    }
  } catch (error) {
    console.error('[machines/destroy] background destroy failed:', error);
  }
}

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

    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('id, server_status, env_name, status')
      .eq('user_id', targetUserId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const activeMachine = await getActiveMachineForUser(supabaseAdmin, targetUserId);
    let lifecycleRecord = subscription
      ? snapshotToMachineRecord(subscription, activeMachine, targetUserId)
      : null;
    const lifecycleCtx = {
      subscriptionActive: subscription?.status === 'active',
      providerDestroyedVerified: true,
    };

    const interrupted = Boolean(req.body?.interrupted);
    const hasActiveMachine = Boolean(activeMachine);

    if (lifecycleRecord?.status === 'running' && subscription && hasActiveMachine) {
      const stopResult = await persistStopRequested(
        supabaseAdmin,
        subscription.id,
        lifecycleRecord,
        lifecycleCtx,
      );
      if (stopResult.machine) lifecycleRecord = stopResult.machine;

      const stoppingView = buildStoppingMachineSessionView(
        { ...subscription, server_status: 'stopping' },
        activeMachine,
        targetUserId,
      );

      const billingView = await resolveBillingSessionView(supabaseAdmin, targetUserId, {
        machine: activeMachine,
        machineSessionPhase: 'stopping',
      });

      res.status(200).json({
        success: true,
        accepted: true,
        message: 'Đang đóng phiên làm việc...',
        reason,
        machineSessionView: stoppingView,
        billingView,
      });

      void completeUserDestroyInBackground(supabaseAdmin, gpuService, {
        targetUserId,
        subscription,
        lifecycleRecord,
        lifecycleCtx,
        interrupted,
        reason,
      });
      return;
    }

    const result = await destroyMachineWithBackup(supabaseAdmin, gpuService, targetUserId, {
      interrupted,
      reason,
    });

    if (lifecycleRecord && subscription) {
      await persistDestroyCompleted(
        supabaseAdmin,
        subscription.id,
        lifecycleRecord,
        lifecycleCtx,
      );
    }

    const machineSessionView = buildIdleMachineSessionView(subscription, targetUserId);
    const billingView = await resolveBillingSessionView(supabaseAdmin, targetUserId, {
      machine: null,
      machineSessionPhase: 'idle',
    });

    if (!result.destroyed) {
      const reset = await resetProvisioningSubscription(supabaseAdmin, targetUserId);
      if (reset.reset) {
        return res.status(200).json({
          success: true,
          message: 'Đã hủy trạng thái khởi động — máy chưa bật.',
          reason,
          machineSessionView,
          billingView,
        });
      }
      if (result.outcome === DESTROY_PIPELINE_OUTCOME.NO_MACHINE) {
        return res.status(200).json({
          success: true,
          alreadyStopped: true,
          message: 'Máy đã tắt.',
          reason,
          machineSessionView,
          billingView,
        });
      }
      return res.status(404).json({ error: 'Không tắt được máy. Vui lòng thử lại.' });
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
      machineSessionView,
      billingView,
      ...destroyPayload,
    });
  } catch (err) {
    console.error('[machines/destroy]', err);
    return res.status(500).json({ error: err.message || 'Không tắt được máy.' });
  }
}
