import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getAdminUserFromRequest, isAdminSecretValid } from '@/lib/admin-auth';
import { DESTROY_PIPELINE_OUTCOME } from '@/lib/destroy-pipeline-core';
import {
  getGpuService,
  snapshotToMachineRecord,
  resolveMachineSessionView,
  persistStopRequested,
  persistDestroyCompleted,
  MACHINE_LIFECYCLE_STATUS,
} from '@/lib/gpu';
import { mapDestroyApiResponse } from '@/lib/gpu/api-scb';
import { resolveBillingSessionView } from '@/lib/gpu/billing-session-view';
import {
  destroyMachineWithBackup,
  normalizeDestroyReason,
  notifyAfterMachineDestroy,
} from '@/lib/machine-destroy';
import { getActiveMachineForUser, resetProvisioningSubscription } from '@/lib/machines';
import { syncUserPlanInventory } from '@/lib/user-plan-inventory';
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

const CLIENT_DRIFT_TOLERANCE_HOURS = 0.05;

/**
 * Read pre-settlement entitlement state for the active subscription/grant.
 * Returns { table, id, hoursTotal, hoursUsed, hoursRemaining } or null.
 */
async function readPreSettlementEntitlement(supabaseAdmin, targetUserId, subscription) {
  if (subscription?.billing === 'hourly') {
    const { data: grant } = await supabaseAdmin
      .from('manual_hour_grants')
      .select('id, hours_granted, hours_used, status')
      .eq('user_id', targetUserId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!grant) return null;
    const total = Number(grant.hours_granted ?? 0);
    const used = Number(grant.hours_used ?? 0);
    return {
      table: 'manual_hour_grants',
      id: grant.id,
      hoursTotal: total,
      hoursUsed: used,
      hoursRemaining: Math.max(0, total - used),
    };
  }
  if (!subscription) return null;
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('id, hours_total, hours_used')
    .eq('id', subscription.id)
    .maybeSingle();
  if (!sub) return null;
  const total = Number(sub.hours_total ?? 0);
  const used = Number(sub.hours_used ?? 0);
  return {
    table: 'subscriptions',
    id: sub.id,
    hoursTotal: total,
    hoursUsed: used,
    hoursRemaining: Math.max(0, total - used),
  };
}

async function overrideEntitlementHoursUsed(supabaseAdmin, target, hoursUsed) {
  if (!target || !target.id || !target.table) return false;
  const safeValue = Math.max(0, Math.min(target.hoursTotal, Number(hoursUsed)));
  // CAS guard: only update if hours_used still matches the pre-settlement value we read.
  // Prevents stale override when a concurrent stop/admin-action already modified hours_used.
  const { data, error } = await supabaseAdmin
    .from(target.table)
    .update({ hours_used: safeValue })
    .eq('id', target.id)
    .eq('hours_used', target.hoursUsed)
    .select('id');
  if (error) {
    console.warn(
      `[machines/destroy] override ${target.table}.hours_used failed:`,
      error.message,
    );
    return false;
  }
  if (!data || data.length === 0) {
    console.warn(
      `[machines/destroy] override ${target.table}.hours_used skipped — CAS mismatch (hours_used changed since pre-settlement read)`,
      { id: target.id, expectedHoursUsed: target.hoursUsed, targetHoursUsed: safeValue },
    );
    return false;
  }
  return true;
}

async function completeUserDestroy(supabaseAdmin, gpuService, params) {
  const { targetUserId, subscription, lifecycleRecord, lifecycleCtx, interrupted, reason } = params;
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

  return result;
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
    const lifecycleRunning = lifecycleRecord?.status === MACHINE_LIFECYCLE_STATUS.RUNNING;
    const billableActive =
      hasActiveMachine &&
      String(activeMachine.status ?? '') === 'running' &&
      Boolean(activeMachine.billing_started_at);

    if ((lifecycleRunning || billableActive) && subscription && hasActiveMachine) {
      const stopResult = await persistStopRequested(
        supabaseAdmin,
        subscription.id,
        lifecycleRecord,
        lifecycleCtx,
      );
      if (stopResult.machine) lifecycleRecord = stopResult.machine;

      // Phương án 4 — client-chốt remaining hours với server validation + override
      const clientRemainingHoursRaw = req.body?.clientRemainingHours;
      const clientRemainingHours =
        clientRemainingHoursRaw != null && Number.isFinite(Number(clientRemainingHoursRaw))
          ? Math.max(0, Number(clientRemainingHoursRaw))
          : null;

      const preSettlementEntitlement = await readPreSettlementEntitlement(
        supabaseAdmin,
        targetUserId,
        subscription,
      ).catch((err) => {
        console.warn('[machines/destroy] readPreSettlementEntitlement failed:', err?.message);
        return null;
      });

      const billingStartedAtMs = activeMachine?.billing_started_at
        ? Date.parse(String(activeMachine.billing_started_at))
        : null;
      const actualSessionSeconds =
        billingStartedAtMs != null && Number.isFinite(billingStartedAtMs)
          ? Math.max(0, Math.floor((Date.now() - billingStartedAtMs) / 1000))
          : 0;
      const actualUsedHours = actualSessionSeconds / 3600;

      let useClientValue = false;
      let clientUsedHours = null;
      if (clientRemainingHours != null && preSettlementEntitlement) {
        const preRemaining = preSettlementEntitlement.hoursRemaining;
        clientUsedHours = preRemaining - clientRemainingHours;
        const nonNegative = clientUsedHours >= -0.001;
        const driftOk =
          Math.abs(clientUsedHours - actualUsedHours) <= CLIENT_DRIFT_TOLERANCE_HOURS;
        const withinCeiling = clientRemainingHours <= preRemaining + 0.001;
        if (nonNegative && driftOk && withinCeiling) {
          useClientValue = true;
        } else {
          console.warn('[machines/destroy] client remaining rejected', {
            clientRemainingHours,
            preRemaining,
            clientUsedHours,
            actualUsedHours,
            nonNegative,
            driftOk,
            withinCeiling,
          });
        }
      }

      let destroyResult = null;
      let destroyError = null;
      try {
        destroyResult = await completeUserDestroy(supabaseAdmin, gpuService, {
          targetUserId,
          subscription,
          lifecycleRecord,
          lifecycleCtx,
          interrupted,
          reason,
        });
      } catch (error) {
        destroyError = error;
        console.error('[machines/destroy] settlement failed:', error);
      }

      if (useClientValue && !destroyError && preSettlementEntitlement && clientUsedHours != null) {
        const targetHoursUsed = Math.max(
          0,
          preSettlementEntitlement.hoursUsed + Math.max(0, clientUsedHours),
        );
        const overridden = await overrideEntitlementHoursUsed(
          supabaseAdmin,
          preSettlementEntitlement,
          targetHoursUsed,
        );
        if (overridden) {
          console.info('[machines/destroy] override hours_used from client', {
            table: preSettlementEntitlement.table,
            id: preSettlementEntitlement.id,
            preHoursUsed: preSettlementEntitlement.hoursUsed,
            targetHoursUsed,
            clientRemainingHours,
          });
        }
      } else if (useClientValue && destroyError) {
        console.warn(
          '[machines/destroy] skip client override — settlement failed, fallback to server-authoritative',
          { destroyErrorMessage: destroyError?.message },
        );
      }

      const idleView = buildIdleMachineSessionView(subscription, targetUserId);
      await syncUserPlanInventory(supabaseAdmin, targetUserId).catch((err) => {
        console.warn('[machines/destroy] syncUserPlanInventory failed (non-fatal):', err);
      });
      const settledBillingView = await resolveBillingSessionView(supabaseAdmin, targetUserId, {
        machine: null,
        machineSessionPhase: 'idle',
      });

      if (destroyError) {
        return res.status(500).json({
          error: 'Phiên đã đóng nhưng settlement thất bại. Vui lòng tải lại trang.',
          machineSessionView: idleView,
          billingView: settledBillingView,
        });
      }

      const backupMessage =
        destroyResult?.backupSuccess === true
          ? ' Dữ liệu đã được backup.'
          : destroyResult?.backupSuccess === false
            ? ' Backup thất bại — vui lòng kiểm tra tab Bộ nhớ.'
            : '';

      return res.status(200).json({
        success: true,
        accepted: true,
        message: `Đã đóng phiên làm việc.${backupMessage}`,
        reason,
        machineSessionView: idleView,
        billingView: settledBillingView,
        ...mapDestroyApiResponse(destroyResult),
      });
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
