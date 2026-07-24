import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getAdminUserFromRequest, isAdminSecretValid } from '@/lib/admin-auth';
import { DESTROY_PIPELINE_OUTCOME } from '@/lib/destroy-pipeline-core';
import {
  getGpuServiceForMachine,
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
import {
  getActiveMachineForUser,
  getBillableSessionMachineForUser,
  resetProvisioningSubscription,
  updateSubscriptionServerStatus,
} from '@/lib/machines';
import { syncUserPlanInventory } from '@/lib/user-plan-inventory';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/** Allow backup wait (up to ~90s) + Clore cancel retries in one invocation. */
export const config = {
  maxDuration: 120,
};

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

/**
 * After persistStopRequested, failed provider destroy must not leave
 * subscriptions.server_status='stopping' — F5 would stuck the dashboard.
 */
async function rollbackStopRequested(supabaseAdmin, subscription, activeMachine, targetUserId) {
  if (subscription?.id) {
    try {
      await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'online');
    } catch (error) {
      console.warn('[machines/destroy] rollback server_status→online failed:', error?.message ?? error);
    }
  }
  const rolled = subscription ? { ...subscription, server_status: 'online' } : null;
  const record = snapshotToMachineRecord(rolled, activeMachine, targetUserId);
  return {
    machineSessionView: resolveMachineSessionView(record, {
      envName: rolled?.env_name ?? null,
    }),
    billingView: await resolveBillingSessionView(supabaseAdmin, targetUserId, {
      machine: activeMachine,
      machineSessionPhase: 'running',
    }).catch(() => null),
  };
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
  const {
    targetUserId,
    subscription,
    lifecycleRecord,
    lifecycleCtx,
    interrupted,
    reason,
    forceStop = false,
    waitForBackup = false,
  } = params;

  const interactive = reason === 'user_stop' || reason === 'admin_stop';
  /** @type {Record<string, unknown>} */
  const destroyOpts = {
    interrupted,
    reason,
  };

  if (forceStop) {
    destroyOpts.skipBackup = true;
    destroyOpts.requireBackupSuccess = false;
  } else if (interactive) {
    // Backup must succeed before provider cancel; UI offers force/wait on failure.
    destroyOpts.requireBackupSuccess = true;
    destroyOpts.backupMode = waitForBackup ? 'wait' : 'required';
    destroyOpts.backupTimeoutMs = waitForBackup ? 90_000 : 45_000;
    destroyOpts.allowSshBackupFallback = Boolean(waitForBackup);
  }

  const result = await destroyMachineWithBackup(supabaseAdmin, gpuService, targetUserId, destroyOpts);

  // Only advance lifecycle to destroyed when the provider destroy actually succeeded.
  // Marking DESTROY_COMPLETED on a failed cancel leaves the UI/DB believing the GPU is off
  // while Clore/Vast may still be billing.
  if (result.destroyed && lifecycleRecord && subscription) {
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

    // Include Runtime DEAD (error) machines bound to an open billable session.
    const activeMachine =
      (await getActiveMachineForUser(supabaseAdmin, targetUserId)) ??
      (await getBillableSessionMachineForUser(supabaseAdmin, targetUserId));

    // Prefer the subscription linked to the running machine — not "newest active"
    // (user may have Starter + Pro; wrong row breaks stop lifecycle / settlement).
    let subscription = null;
    if (activeMachine?.subscription_id) {
      const { data } = await supabaseAdmin
        .from('subscriptions')
        .select('id, server_status, env_name, status, billing, plan')
        .eq('id', String(activeMachine.subscription_id))
        .maybeSingle();
      subscription = data;
    }
    if (!subscription) {
      const { data } = await supabaseAdmin
        .from('subscriptions')
        .select('id, server_status, env_name, status, billing, plan')
        .eq('user_id', targetUserId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      subscription = data;
    }

    const gpuService = getGpuServiceForMachine(activeMachine);
    let lifecycleRecord = subscription
      ? snapshotToMachineRecord(subscription, activeMachine, targetUserId)
      : null;
    const lifecycleCtx = {
      subscriptionActive: subscription?.status === 'active',
      providerDestroyedVerified: true,
    };

    const interrupted = Boolean(req.body?.interrupted);
    const forceStop = Boolean(req.body?.forceStop);
    const waitForBackup = Boolean(req.body?.waitForBackup);
    const hasActiveMachine = Boolean(activeMachine);
    const machineStatus = String(activeMachine?.status ?? '');
    const lifecycleRunning =
      lifecycleRecord?.status === MACHINE_LIFECYCLE_STATUS.RUNNING ||
      lifecycleRecord?.status === MACHINE_LIFECYCLE_STATUS.ERROR;
    const billableActive =
      hasActiveMachine &&
      Boolean(activeMachine.billing_started_at) &&
      ['running', 'error', 'starting', 'creating'].includes(machineStatus);

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
      // Runtime DEAD: never block Close on backup / provider flakiness.
      const effectiveForceStop = forceStop || machineStatus === 'error';
      try {
        destroyResult = await completeUserDestroy(supabaseAdmin, gpuService, {
          targetUserId,
          subscription,
          lifecycleRecord,
          lifecycleCtx,
          interrupted,
          reason,
          forceStop: effectiveForceStop,
          waitForBackup: effectiveForceStop ? false : waitForBackup,
        });
      } catch (error) {
        destroyError = error;
        console.error('[machines/destroy] settlement failed:', error);
      }

      if (destroyError) {
        console.warn(
          '[machines/destroy] destroy threw — not settling hours or marking idle',
          { message: destroyError?.message },
        );
        const rolledBack = await rollbackStopRequested(
          supabaseAdmin,
          subscription,
          activeMachine,
          targetUserId,
        );
        return res.status(500).json({
          error: 'Không tắt được máy (lỗi hệ thống). Vui lòng thử lại sau vài giây.',
          retryable: true,
          ...rolledBack,
        });
      }

      if (destroyResult?.outcome === DESTROY_PIPELINE_OUTCOME.BACKUP_FAILED) {
        console.warn('[machines/destroy] backup incomplete — awaiting customer choice', {
          backupStatus: destroyResult?.backupStatus ?? null,
          waitForBackup,
          forceStop,
        });
        const rolledBack = await rollbackStopRequested(
          supabaseAdmin,
          subscription,
          activeMachine,
          targetUserId,
        );
        return res.status(409).json({
          code: 'BACKUP_CHOICE_REQUIRED',
          error:
            'Chưa lưu xong dữ liệu lên bộ nhớ trước khi tắt máy. Bạn có thể tắt ngay (có rủi ro mất dữ liệu chưa sync) hoặc tiếp tục chờ lưu.',
          backupStatus: destroyResult?.backupStatus ?? 'failed',
          choices: ['force_stop', 'wait_backup'],
          retryable: true,
          reason,
          ...rolledBack,
          ...mapDestroyApiResponse(destroyResult),
        });
      }

      if (!destroyResult?.destroyed) {
        console.warn('[machines/destroy] provider destroy incomplete', {
          outcome: destroyResult?.outcome,
          lastStep: destroyResult?.lastStep,
          retryable: destroyResult?.retryable,
          machineStatus,
          forceStop,
          settlement: destroyResult?.settlement?.settlementStatus ?? null,
        });

        // Runtime DEAD / forceStop / billing already closed at P0-B Close:
        // never 409→rollback to "online/running" (that traps the reconnect UI).
        const billingAlreadyClosed = Boolean(
          destroyResult?.settlement || destroyResult?.billingResult?.settlement,
        );
        const acceptLocalClose =
          machineStatus === 'error' ||
          forceStop === true ||
          effectiveForceStop === true ||
          billingAlreadyClosed;

        if (acceptLocalClose) {
          const nowIso = new Date().toISOString();
          try {
            if (activeMachine?.id) {
              await supabaseAdmin
                .from('machines')
                .update({
                  status: 'destroyed',
                  stopped_at: nowIso,
                  updated_at: nowIso,
                  billing_started_at: null,
                  gpu_session_id: null,
                  projection_message: null,
                })
                .eq('id', String(activeMachine.id));
            }
            if (subscription?.id) {
              await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');
            }
            if (lifecycleRecord && subscription) {
              await persistDestroyCompleted(
                supabaseAdmin,
                subscription.id,
                lifecycleRecord,
                { ...lifecycleCtx, providerDestroyedVerified: true },
              );
            }
          } catch (cleanupErr) {
            console.warn(
              '[machines/destroy] local Runtime DEAD cleanup failed:',
              cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
            );
          }

          const idleView = buildIdleMachineSessionView(subscription, targetUserId);
          await syncUserPlanInventory(supabaseAdmin, targetUserId).catch(() => {});
          const settledBillingView = await resolveBillingSessionView(supabaseAdmin, targetUserId, {
            machine: null,
            machineSessionPhase: 'idle',
          });
          return res.status(200).json({
            success: true,
            accepted: true,
            forcedLocalClose: true,
            message: 'Đã đóng phiên làm việc.',
            reason,
            machineSessionView: idleView,
            billingView: settledBillingView,
            verifiedDestroyedAt: nowIso,
            ...mapDestroyApiResponse(destroyResult),
          });
        }

        const rolledBack = await rollbackStopRequested(
          supabaseAdmin,
          subscription,
          activeMachine,
          targetUserId,
        );
        return res.status(409).json({
          error:
            'Chưa xác nhận được máy đã tắt. GPU có thể vẫn đang chạy — vui lòng thử lại sau vài giây.',
          retryable: true,
          reason,
          ...rolledBack,
          ...mapDestroyApiResponse(destroyResult),
        });
      }

      // Hours override only after a verified provider destroy.
      if (useClientValue && preSettlementEntitlement && clientUsedHours != null) {
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
      }

      const idleView = buildIdleMachineSessionView(subscription, targetUserId);
      await syncUserPlanInventory(supabaseAdmin, targetUserId).catch((err) => {
        console.warn('[machines/destroy] syncUserPlanInventory failed (non-fatal):', err);
      });
      const settledBillingView = await resolveBillingSessionView(supabaseAdmin, targetUserId, {
        machine: null,
        machineSessionPhase: 'idle',
      });

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

    if (result.destroyed && lifecycleRecord && subscription) {
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
      return res.status(409).json({
        error:
          'Chưa tắt được máy phía provider. Vui lòng thử lại sau vài giây.',
        retryable: Boolean(result.retryable),
        reason,
        ...mapDestroyApiResponse(result),
      });
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
