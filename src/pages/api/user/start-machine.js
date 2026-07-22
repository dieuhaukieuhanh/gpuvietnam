import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';

import {
  getGpuService,
  getGpuServiceForMachine,
  repairUserBillingState,
  resolveGpuLineFromPlan,
  snapshotToMachineRecord,
  resolveMachineSessionView,
  persistStartRequested,
} from '@/lib/gpu';
import {
  isMachineBooting,
  isRecentBootMachine,
  isStaleProvisioningClaim,
  STALE_PROVISIONING_CLAIM_MS,
  shouldRepairBootingSubscriptionDrift,
  shouldRetryProvisioningForBoot,
} from '@/lib/machines-provisioning-sync';

import { getGpuLabel, getPlanNameFromKey } from '@/lib/gpu-pricing';

import { buildWorkstationContainerEnv, isGpuComfyWorkstation, resolveEnvName } from '@/lib/workstation-env';
import {
  issueMachineBackupToken,
  resolvePresignUploadApiUrl,
} from '@/lib/machine-backup-token';
import { getBackupQuotaStatus } from '@/lib/backup-quota';
import { createBackupFlushSecret } from '@/lib/backup-container-env';
import { isAutoBackupEnabledForUser, loadBackupIntervalsByPlan } from '@/lib/backup-auto-policy';
import { WORKSTATIONS } from '@/lib/workstations';

import { buildConsumerEndpoint } from '@/lib/endpoint-utils';
import { redactComfyUpstreamForClient, isComfyProxyEnabled } from '@/lib/comfy-proxy';
import { scrubMachineForCustomer } from '@/lib/machines-public';

import {
  bindRequestActors,
  getLogContext,
  logger,
  resolveRequestId,
  withApiLogging,
} from '@/lib/logging';

import {
  getActiveMachineForUser,
  resolveLiveMachineStatus,
  syncMachineFromLiveStatus,
  updateSubscriptionServerStatus,
  destroyUserMachine,
  reclaimStaleProvisionClaim,
  buildProvisionAttemptLabel,
} from '@/lib/machines';

import { getSupabaseAdmin } from '@/lib/supabase-admin';

import { enqueueUserStartProvision } from '@/lib/infrastructure/enqueue-user-start-provision';
import { resolveBillingViewForCommand } from '@/lib/gpu/billing-session-view';

import { activateInventoryPlan, parseInventoryId } from '@/lib/user-plan-inventory';

import { fetchUserActivePlans, findActivePlanSelection, normalizePlanKey } from '@/lib/user-active-plans';
import {
  decideResumeFromLoadedState,
  incrSessionResumeMetric,
  logSessionResumeEvent,
} from '@/lib/session-resume/index.js';
import { setProvisionProgress, PROVISION_STAGE } from '@/lib/provision-progress/index.js';

/**
 * Stamp provisioning_started_at when missing (legacy rows) without starting a new rent.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} subscriptionId
 */
async function stampProvisioningClaimStartedAt(supabaseAdmin, subscriptionId) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .update({ provisioning_started_at: nowIso })
    .eq('id', subscriptionId)
    .eq('server_status', 'provisioning')
    .is('provisioning_started_at', null)
    .select('id, server_status, provisioning_started_at')
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}



function buildMachineResponse(machine, liveStatus) {
  const healthOk = liveStatus?.healthOk === true;
  const endpoint = buildConsumerEndpoint(machine, healthOk);

  // Allowlist only — never include machines.image (admin audit).
  return scrubMachineForCustomer(
    redactComfyUpstreamForClient({
      instanceId: machine?.instance_id ?? liveStatus?.instanceId ?? null,
      machineId: machine?.instance_id ?? liveStatus?.instanceId ?? null,
      ip: endpoint.ip,
      port: endpoint.port,
      status: liveStatus?.status ?? machine?.status ?? 'creating',
      comfyUrl: endpoint.comfyUrl,
      template: machine?.template ? String(machine.template) : null,
      message: liveStatus?.message ?? null,
      comfyProxyEnabled: isComfyProxyEnabled(),
    }),
  );
}

function buildMachineSessionView(subscription, machine, userId, options = {}) {
  const record = snapshotToMachineRecord(subscription, machine, userId);
  return resolveMachineSessionView(record, {
    envName: subscription?.env_name ?? null,
    ...options,
  });
}

async function billingViewForStart(supabaseAdmin, userId, gpuService, machineSessionView, machine) {
  return resolveBillingViewForCommand(supabaseAdmin, userId, {
    machineSessionView,
    machine: machine ?? null,
    gpuService,
  });
}

function machineLifecycleContext(subscription) {
  return { subscriptionActive: subscription?.status === 'active' };
}

/**
 * Attach Session Resume metadata so the client can restore UI without a new provision.
 * @param {Record<string, unknown>} body
 * @param {{
 *   subscription?: Record<string, unknown> | null;
 *   machine?: Record<string, unknown> | null;
 *   liveStatus?: { status?: string; healthOk?: boolean } | null;
 *   requestId?: string | null;
 * }} ctx
 */
function withResumeMeta(body, ctx) {
  const decision = decideResumeFromLoadedState({
    subscription: ctx.subscription,
    machine: ctx.machine,
    liveStatus: ctx.liveStatus ?? null,
  });
  if (decision.duplicateStartPrevented) {
    incrSessionResumeMetric('duplicateStartPrevented');
    incrSessionResumeMetric('resumeSuccess');
    logSessionResumeEvent(
      decision.currentState === 'RUNNING' ? 'SESSION_ALREADY_RUNNING' : 'SESSION_RESUME_FOUND',
      {
        requestId: ctx.requestId,
        machineId: ctx.machine?.id ?? ctx.machine?.instance_id ?? null,
        provider: ctx.machine?.provider ?? null,
        currentState: decision.currentState,
        reason: decision.reason,
        source: 'start-machine',
      },
      'Start blocked — resuming existing session',
    );
  }
  return {
    ...body,
    resumed: decision.shouldResume,
    duplicateStartPrevented: decision.duplicateStartPrevented,
    sessionResume: {
      shouldResume: decision.shouldResume,
      allowNewProvision: decision.allowNewProvision,
      duplicateStartPrevented: decision.duplicateStartPrevented,
      currentState: decision.currentState,
      progressStep: decision.progressStep,
      reason: decision.reason,
      requestId: ctx.requestId ?? null,
      machineId: ctx.machine?.id != null ? String(ctx.machine.id) : null,
      instanceId: ctx.machine?.instance_id != null ? String(ctx.machine.instance_id) : null,
      provider: ctx.machine?.provider != null ? String(ctx.machine.provider) : null,
      lease: ctx.subscription
        ? {
            leaseId: ctx.subscription.provisioning_lease_id ?? null,
            expiresAt: ctx.subscription.provisioning_lease_expires_at ?? null,
            heartbeatAt: ctx.subscription.provisioning_heartbeat_at ?? null,
            owner: ctx.subscription.provisioning_lease_owner ?? null,
            startedAt: ctx.subscription.provisioning_started_at ?? null,
          }
        : null,
    },
  };
}



async function startMachineHandler(req, res) {

  if (req.method !== 'POST') {

    return res.status(405).json({ error: 'Method not allowed' });

  }



  const correlationId = getLogContext().requestId ?? resolveRequestId(req);

  let rentedInstanceId = null;

  let insertedMachineId = null;

  let provisioningSubscriptionId = null;

  let userId = null;

  /** @type {import('@/lib/gpu/gpu-service').GPUService | null} */

  let gpuService = null;

  const supabaseAdmin = getSupabaseAdmin();

  const log = logger('api');



  try {

    const user = await getAuthUserFromRequest(req);

    if (!user) return unauthorized(res);

    userId = user.id;

    bindRequestActors({ userId, requestId: correlationId, operation: 'user.startMachine' });

    const body = req.body ?? {};
    log.info(
      {
        operation: 'user.startMachine',
        phase: 'START',
        userId,
        planId: body.planId ?? null,
        planType: body.type ?? null,
        planKey: body.plan ?? null,
        inventoryId: body.inventoryId ?? null,
        subscriptionId: body.subscriptionId ?? null,
        envName: body.envName ?? null,
      },
      'START MACHINE REQUEST',
    );



    const { planId, type, plan, inventoryId, subscriptionId, envName: requestedEnvNameRaw } = req.body ?? {};

    const { plans } = await fetchUserActivePlans(supabaseAdmin, user.id);



    const selected = findActivePlanSelection(plans, {

      planId,

      type,

      plan,

      inventoryId,

      subscriptionId,

    });

    if (!selected) {

      return res.status(400).json({ error: 'Gói đã chọn không còn hợp lệ.' });

    }



    if (selected.inventoryId) {
      await activateInventoryPlan(supabaseAdmin, user.id, selected.inventoryId);
    }

    // Authoritative GPU tier = inventory row the user selected/activated (not newest subscription).
    let planKey = normalizePlanKey(selected.plan);
    if (selected.inventoryId) {
      const parsedInventoryId = parseInventoryId(selected.inventoryId);
      if (parsedInventoryId) {
        const { data: invRow, error: invErr } = await supabaseAdmin
          .from('user_plan_inventory')
          .select('id, plan_name, subscription_id, is_active')
          .eq('id', parsedInventoryId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (invErr) throw invErr;
        const fromInventory = normalizePlanKey(invRow?.plan_name);
        if (fromInventory) {
          planKey = fromInventory;
        }
        console.info('[user/start-machine] inventory plan resolution', {
          inventoryId: parsedInventoryId,
          plan_name: invRow?.plan_name ?? null,
          planKey,
          is_active: invRow?.is_active ?? null,
          bodyPlan: plan ?? null,
          selectedPlan: selected.plan ?? null,
        });
      }
    }
    if (!planKey) {
      return res.status(400).json({
        error: 'Không xác định được loại gói (Starter / Pro / Studio). Vui lòng chọn lại gói.',
      });
    }

    const { data: subscriptionRow, error: subError } = await supabaseAdmin

      .from('subscriptions')

      .select('id, status, server_status, provisioning_started_at, provisioning_lease_id, provisioning_lease_expires_at, provisioning_heartbeat_at, provisioning_lease_owner, env_name, billing, plan, gpu_label')

      .eq('user_id', user.id)

      .eq('status', 'active')

      .order('created_at', { ascending: false })

      .limit(1)

      .maybeSingle();



    if (subError) throw subError;

    if (!subscriptionRow) {

      return res.status(400).json({ error: 'Không tìm thấy gói chính để khởi động máy.' });

    }

    let subscription = subscriptionRow;

    if (selected.subscriptionId && subscription.id !== selected.subscriptionId) {

      const { data: selectedSub, error: selectedSubError } = await supabaseAdmin

        .from('subscriptions')

        .select('id, status, server_status, provisioning_started_at, provisioning_lease_id, provisioning_lease_expires_at, provisioning_heartbeat_at, provisioning_lease_owner, env_name, billing, plan, gpu_label')

        .eq('id', selected.subscriptionId)

        .eq('user_id', user.id)

        .eq('status', 'active')

        .maybeSingle();

      if (selectedSubError) throw selectedSubError;

      if (selectedSub) subscription = selectedSub;

    }

    const requestedEnvName =
      typeof requestedEnvNameRaw === 'string' && requestedEnvNameRaw.trim()
        ? requestedEnvNameRaw.trim()
        : null;
    if (requestedEnvName) {
      const workstation = WORKSTATIONS.find((item) => item.name === requestedEnvName);
      if (!workstation || !isGpuComfyWorkstation(workstation)) {
        return res.status(400).json({
          error:
            'Môi trường không hợp lệ. Hiện chỉ hỗ trợ 3 môi trường ComfyUI: Character & Art, Commerce & Product, Video AI.',
        });
      }
      if (workstation.name !== subscription.env_name) {
        const { data: envUpdated, error: envUpdateError } = await supabaseAdmin
          .from('subscriptions')
          .update({
            env_name: workstation.name,
            env_icon: workstation.icon,
            env_desc: workstation.desc,
          })
          .eq('id', subscription.id)
          .select('id, status, server_status, provisioning_started_at, provisioning_lease_id, provisioning_lease_expires_at, provisioning_heartbeat_at, provisioning_lease_owner, env_name, billing, plan, gpu_label')
          .single();
        if (envUpdateError) throw envUpdateError;
        subscription = { ...subscription, ...envUpdated };
        console.info('[user/start-machine] Synced subscription env before boot:', workstation.name);
      }
    }

    const targetEnvName = resolveEnvName(requestedEnvName ?? subscription.env_name);

    console.info('📦 Subscription loaded:');

    console.info('subscription:', JSON.stringify(subscription, null, 2));

    console.info('env_name:', subscription.env_name);

    console.info('server_status:', subscription.server_status);



    gpuService = getGpuService();

    await repairUserBillingState(supabaseAdmin, user.id);

    let existingMachine = await getActiveMachineForUser(supabaseAdmin, user.id);
    if (existingMachine) {
      gpuService = getGpuServiceForMachine(existingMachine);
    }



    if (existingMachine && subscription.server_status === 'offline') {
      if (shouldRepairBootingSubscriptionDrift(existingMachine, subscription.server_status)) {
        await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'provisioning');
        subscription = { ...subscription, server_status: 'provisioning' };
      } else if (!isMachineBooting(existingMachine) || !isRecentBootMachine(existingMachine)) {
        console.warn('[user/start-machine] Stale leaked machine while offline — destroying before boot');
        await destroyUserMachine(supabaseAdmin, gpuService, user.id, {
          interrupted: true,
          skipBackup: true,
          skipBilling: String(existingMachine.status ?? '') !== 'running',
          reason: 'retry_provision',
        });
        existingMachine = null;
        gpuService = getGpuService();
      }
    }

    if (subscription.server_status === 'online' && existingMachine) {

      const liveStatus = await resolveLiveMachineStatus(gpuService, existingMachine);

      if (liveStatus.status === 'running') {

        const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, existingMachine, liveStatus);

        const machineSessionView = buildMachineSessionView(
            subscription,
            syncedMachine,
            user.id,
            { comfyUrl: buildMachineResponse(syncedMachine, liveStatus).comfyUrl },
          );
        const billingView = await billingViewForStart(
          supabaseAdmin,
          user.id,
          gpuService,
          machineSessionView,
          syncedMachine,
        );

        return res.status(200).json(withResumeMeta({

          success: true,

          alreadyOnline: true,

          message: 'Máy đang chạy.',

          selectedPlan: selected,

          machine: buildMachineResponse(syncedMachine, liveStatus),

          machineSessionView,
          billingView,

        }, {
          subscription,
          machine: syncedMachine,
          liveStatus,
          requestId: correlationId,
        }));

      }

      if (liveStatus.status === 'starting' || liveStatus.status === 'creating') {
        const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, existingMachine, liveStatus);

        if (
          shouldRetryProvisioningForBoot(existingMachine, liveStatus, targetEnvName)
        ) {
          console.warn('[user/start-machine] Boot env mismatch or stale — retrying provider rent', {
            machineTemplate: existingMachine.template ?? null,
            targetEnvName,
          });
          await destroyUserMachine(supabaseAdmin, gpuService, user.id, {
            interrupted: true,
            skipBackup: true,
            skipBilling: String(existingMachine.status ?? '') !== 'running',
            reason: 'retry_provision',
          });
          existingMachine = null;
          gpuService = getGpuService();
          await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');
          subscription = { ...subscription, server_status: 'offline' };
        } else {
          const machineSessionView = buildMachineSessionView(subscription, syncedMachine, user.id);
          const billingView = await billingViewForStart(
            supabaseAdmin,
            user.id,
            gpuService,
            machineSessionView,
            syncedMachine,
          );
          return res.status(200).json(withResumeMeta({
            success: true,
            alreadyStarting: true,
            message: 'Đang khởi động máy GPU...',
            selectedPlan: selected,
            machine: buildMachineResponse(syncedMachine, liveStatus),
            machineSessionView,
            billingView,
          }, {
            subscription,
            machine: syncedMachine,
            liveStatus,
            requestId: correlationId,
          }));
        }
      }

      console.warn('[user/start-machine] Stale online projection — cleaning up before re-provision', {

        liveStatus: liveStatus.status,

        message: liveStatus.message ?? null,

        machineId: existingMachine.id ?? null,

        driftAction: null,

      });

      if (existingMachine) {

        await destroyUserMachine(supabaseAdmin, gpuService, user.id, {

          interrupted: true,

          skipBackup: true,

          skipBilling: String(existingMachine.status ?? '') !== 'running',

          reason: 'retry_provision',

        });

        existingMachine = null;
        gpuService = getGpuService();

      }

      await updateSubscriptionServerStatus(supabaseAdmin, subscription.id, 'offline');

      subscription = { ...subscription, server_status: 'offline' };

    }



    if (subscription.server_status === 'provisioning' && !existingMachine) {
      const planNameForClaim = getPlanNameFromKey(planKey) ?? selected.plan;

      if (subscription.provisioning_started_at == null) {
        const stamped = await stampProvisioningClaimStartedAt(supabaseAdmin, subscription.id);
        if (stamped?.provisioning_started_at) {
          subscription = {
            ...subscription,
            provisioning_started_at: stamped.provisioning_started_at,
          };
        }
        console.info('[user/start-machine] Boot in progress — stamped claim time, waiting');
      } else if (isStaleProvisioningClaim(subscription)) {
        const staleBeforeIso = new Date(Date.now() - STALE_PROVISIONING_CLAIM_MS).toISOString();
        const reclaimed = await reclaimStaleProvisionClaim(supabaseAdmin, subscription.id, {
          staleBeforeIso,
          plan: planNameForClaim,
          gpu_label: getGpuLabel(planKey),
          requestId: correlationId,
        });

        if (reclaimed) {
          console.warn('[user/start-machine] Recovered expired provision lease — starting one provision');
          subscription = {
            ...subscription,
            server_status: 'provisioning',
            provisioning_started_at: reclaimed.provisioning_started_at,
            provisioning_lease_id: reclaimed.provisioning_lease_id,
            provisioning_lease_expires_at: reclaimed.provisioning_lease_expires_at,
            provisioning_heartbeat_at: reclaimed.provisioning_heartbeat_at,
            provisioning_lease_owner: reclaimed.provisioning_lease_owner,
            plan: planNameForClaim,
            gpu_label: getGpuLabel(planKey),
          };
          const gpuLine = resolveGpuLineFromPlan(planKey);
          const envName = targetEnvName;
          /** @type {string | null} */
          let reclaimBackupTokenId = null;
          /** @type {Record<string, string>} */
          let reclaimEnv = buildWorkstationContainerEnv(envName);
          try {
            const presignUrl = resolvePresignUploadApiUrl();
            const autoBackupOn = await isAutoBackupEnabledForUser(
              supabaseAdmin,
              user.id,
              planKey,
            );
            if (presignUrl && autoBackupOn) {
              const issued = await issueMachineBackupToken(supabaseAdmin, {
                userId: user.id,
                subscriptionId: subscription.id,
              });
              reclaimBackupTokenId = issued.id;
              let reclaimSkipModels = false;
              try {
                const q = await getBackupQuotaStatus(supabaseAdmin, user.id);
                reclaimSkipModels = Boolean(q.skipModels);
              } catch {
                /* ignore */
              }
              reclaimEnv = buildWorkstationContainerEnv(envName, {
                userId: user.id,
                backupToken: issued.token,
                presignUrl,
                skipModels: reclaimSkipModels,
                flushSecret: createBackupFlushSecret(),
                planKey,
                intervalsByPlan: await loadBackupIntervalsByPlan(supabaseAdmin),
              });
            } else if (presignUrl && !autoBackupOn) {
              console.info(
                '[user/start-machine] reclaim skip backup token: auto backup disabled',
                { userId: user.id, planKey },
              );
            }
          } catch (tokenErr) {
            console.warn(
              '[user/start-machine] reclaim issueMachineBackupToken failed:',
              tokenErr instanceof Error ? tokenErr.message : tokenErr,
            );
          }
          try {
            await enqueueUserStartProvision(supabaseAdmin, {
              userId: user.id,
              subscriptionId: subscription.id,
              correlationId,
              selected,
              planKey,
              planName: planNameForClaim,
              gpuLine,
              envName,
              workstationContainerEnv: reclaimEnv,
              backupTokenId: reclaimBackupTokenId,
              lifecycleCtx: machineLifecycleContext(subscription),
              provisionLabel: buildProvisionAttemptLabel({
                userId: user.id,
                subscriptionId: subscription.id,
                correlationId,
              }),
            });
          } catch (enqueueErr) {
            log.error(
              {
                operation: 'user.startProvision',
                phase: 'FAILURE',
                err: {
                  message: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
                },
              },
              'durable enqueue reclaim failed',
            );
          }
        } else {
          console.info('[user/start-machine] Lease reclaim lost race — waiting');
        }
      } else {
        console.info('[user/start-machine] Boot already in progress (no machine row yet) — waiting');
      }

      const machineSessionView = buildMachineSessionView(subscription, null, user.id);
      const billingView = await billingViewForStart(
        supabaseAdmin,
        user.id,
        gpuService,
        machineSessionView,
        null,
      );
      return res.status(200).json(withResumeMeta({
        success: true,
        alreadyStarting: true,
        message: 'Đang khởi tạo máy GPU. Vui lòng đợi...',
        selectedPlan: selected,
        machineSessionView,
        billingView,
      }, {
        subscription,
        machine: null,
        requestId: correlationId,
      }));
    }
    if (subscription.server_status === 'provisioning' && existingMachine) {

      const liveStatus = await resolveLiveMachineStatus(gpuService, existingMachine);

      const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, existingMachine, liveStatus);



      if (!shouldRetryProvisioningForBoot(existingMachine, liveStatus, targetEnvName)) {
        const machineSessionView = buildMachineSessionView(subscription, syncedMachine, user.id);
        const billingView = await billingViewForStart(
          supabaseAdmin,
          user.id,
          gpuService,
          machineSessionView,
          syncedMachine,
        );

        return res.status(200).json(withResumeMeta({

          success: true,

          alreadyStarting: true,

          message: 'Đang khởi động máy GPU...',

          selectedPlan: selected,

          machine: buildMachineResponse(syncedMachine, liveStatus),

          machineSessionView,
          billingView,

        }, {
          subscription,
          machine: syncedMachine,
          liveStatus,
          requestId: correlationId,
        }));

      }



      console.warn('[user/start-machine] Stale provisioning or env mismatch — retrying provider rent', {
        machineTemplate: existingMachine.template ?? null,
        targetEnvName,
      });

      await destroyUserMachine(supabaseAdmin, gpuService, user.id, {

        interrupted: true,

        skipBackup: true,

        skipBilling: String(existingMachine.status ?? '') !== 'running',

        reason: 'retry_provision',

      });

      existingMachine = null;
      gpuService = getGpuService();

    }



    const planName = getPlanNameFromKey(planKey) ?? selected.plan;

    const gpuLine = resolveGpuLineFromPlan(planKey);
    if (!gpuLine) {
      return res.status(400).json({
        error: 'Không map được cấu hình GPU cho gói ' + planKey + '.',
      });
    }

    // Keep linked subscription stamp in sync only when inventory belongs to that subscription.
    // Gift inventory (no subscription_id) must not rewrite another package's plan/billing fields.
    if (
      selected.subscriptionId &&
      selected.subscriptionId === subscription.id &&
      (normalizePlanKey(subscription.plan) !== planKey ||
        String(subscription.gpu_label ?? '') !== getGpuLabel(planKey))
    ) {
      const { data: stampedSub, error: stampErr } = await supabaseAdmin
        .from('subscriptions')
        .update({ plan: planName, gpu_label: getGpuLabel(planKey) })
        .eq('id', subscription.id)
        .eq('user_id', user.id)
        .select('id, status, server_status, provisioning_started_at, provisioning_lease_id, provisioning_lease_expires_at, provisioning_heartbeat_at, provisioning_lease_owner, env_name, billing, plan, gpu_label')
        .maybeSingle();
      if (stampErr) {
        console.warn('[user/start-machine] subscription plan stamp failed:', stampErr.message);
      } else if (stampedSub) {
        subscription = { ...subscription, ...stampedSub };
      }
    }

    const envName = targetEnvName;

    /** @type {string | null} */
    let backupTokenId = null;
    /** @type {Record<string, string>} */
    let workstationContainerEnv = buildWorkstationContainerEnv(envName);
    try {
      const presignUrl = resolvePresignUploadApiUrl();
      const autoBackupOn = await isAutoBackupEnabledForUser(
        supabaseAdmin,
        user.id,
        planKey,
      );
      if (presignUrl && autoBackupOn) {
        const issued = await issueMachineBackupToken(supabaseAdmin, {
          userId: user.id,
          subscriptionId: subscription.id,
        });
        backupTokenId = issued.id;
        let skipModels = false;
        try {
          const q = await getBackupQuotaStatus(supabaseAdmin, user.id);
          skipModels = Boolean(q.skipModels);
        } catch {
          /* ignore */
        }
        workstationContainerEnv = buildWorkstationContainerEnv(envName, {
          userId: user.id,
          backupToken: issued.token,
          presignUrl,
          skipModels,
          flushSecret: createBackupFlushSecret(),
          planKey,
          intervalsByPlan: await loadBackupIntervalsByPlan(supabaseAdmin),
        });
      } else if (!presignUrl) {
        console.warn(
          '[user/start-machine] GPUVIETNAM_PUBLIC_API_URL / NEXT_PUBLIC_APP_URL missing — skip backup token env',
        );
      } else {
        console.info(
          '[user/start-machine] skip backup token: auto backup disabled',
          { userId: user.id, planKey },
        );
      }
    } catch (tokenErr) {
      console.warn(
        '[user/start-machine] issueMachineBackupToken failed:',
        tokenErr instanceof Error ? tokenErr.message : tokenErr,
      );
    }



    console.info('🔧 Resolved start-machine context:');

    console.info('planKey:', planKey);

    console.info('gpuLine:', gpuLine);

    console.info('envName:', envName);

    console.info('buildWorkstationContainerEnv(envName):', JSON.stringify({
      ...workstationContainerEnv,
      GPUVIETNAM_BACKUP_TOKEN: workstationContainerEnv.GPUVIETNAM_BACKUP_TOKEN
        ? '[redacted]'
        : undefined,
      GPUVIETNAM_BACKUP_FLUSH_SECRET: workstationContainerEnv.GPUVIETNAM_BACKUP_FLUSH_SECRET
        ? '[redacted]'
        : undefined,
    }, null, 2));



    const lifecycleCtx = machineLifecycleContext(subscription);
    const lifecycleRecord = snapshotToMachineRecord(subscription, existingMachine, user.id);

    const startTransition = await persistStartRequested(
      supabaseAdmin,
      subscription.id,
      lifecycleRecord,
      lifecycleCtx,
      {
        userId: user.id,
        subscriptionId: subscription.id,
        envName,
        plan: planName,
        gpuLabel: getGpuLabel(planKey),
        correlationId,
      },
    );

    if (startTransition.state === 'ERROR') {
      return res.status(409).json({ error: startTransition.message });
    }

    if (startTransition.state === 'IGNORED') {
      const bootMachine = await getActiveMachineForUser(supabaseAdmin, user.id);
      const machineSessionView = buildMachineSessionView(
        { ...subscription, server_status: 'provisioning' },
        bootMachine,
        user.id,
      );
      const billingView = await billingViewForStart(
        supabaseAdmin,
        user.id,
        gpuService,
        machineSessionView,
        bootMachine,
      );
      return res.status(200).json(withResumeMeta({
        success: true,
        alreadyStarting: true,
        message: 'Đang khởi động máy GPU...',
        selectedPlan: selected,
        machine: bootMachine ? buildMachineResponse(bootMachine, { status: bootMachine.status ?? 'creating' }) : null,
        machineSessionView,
        billingView,
      }, {
        subscription: { ...subscription, server_status: 'provisioning' },
        machine: bootMachine,
        requestId: correlationId,
      }));
    }
    const claimedLease = startTransition.claimed ?? null;
    subscription = {
      ...subscription,
      server_status: startTransition.machine?.serverStatus ?? 'provisioning',
      plan: planName,
      gpu_label: getGpuLabel(planKey),
      ...(claimedLease
        ? {
            provisioning_started_at: claimedLease.provisioning_started_at,
            provisioning_lease_id: claimedLease.provisioning_lease_id,
            provisioning_lease_expires_at: claimedLease.provisioning_lease_expires_at,
            provisioning_heartbeat_at: claimedLease.provisioning_heartbeat_at,
            provisioning_lease_owner: claimedLease.provisioning_lease_owner,
          }
        : {}),
    };

    provisioningSubscriptionId = subscription.id;

    const openingView = buildMachineSessionView(subscription, null, user.id, {
      envName,
    });

    const billingView = await billingViewForStart(
      supabaseAdmin,
      user.id,
      gpuService,
      openingView,
      null,
    );

    const progress = await setProvisionProgress(subscription.id, {
      stage: PROVISION_STAGE.CHECKING_ACCOUNT,
      tick: 'start_accepted',
      requestId: correlationId,
      gpuType: gpuLine,
      supabaseAdmin,
    });

    const provisionLabel = buildProvisionAttemptLabel({
      userId: user.id,
      subscriptionId: subscription.id,
      correlationId,
    });

    let enqueued;
    try {
      enqueued = await enqueueUserStartProvision(supabaseAdmin, {
        userId: user.id,
        subscriptionId: subscription.id,
        correlationId,
        selected,
        planKey,
        planName,
        gpuLine,
        envName,
        workstationContainerEnv,
        backupTokenId,
        lifecycleCtx,
        provisionLabel,
      });
    } catch (enqueueErr) {
      log.error(
        {
          operation: 'user.startProvision',
          phase: 'FAILURE',
          err: {
            message: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
          },
        },
        'durable enqueue failed',
      );
      return res.status(503).json({
        error: 'Không thể xếp hàng khởi tạo GPU. Thử lại sau.',
        code: 'PROVISION_ENQUEUE_FAILED',
      });
    }

    return res.status(200).json({
      success: true,
      accepted: true,
      message: 'Đang khởi tạo máy GPU...',
      operationId: enqueued.operation?.id ?? null,
      selectedPlan: selected,
      subscription: {
        id: subscription.id,
        server_status: subscription.server_status,
        plan: planName,
        gpu_label: getGpuLabel(planKey),
      },
      machineSessionView: openingView,
      billingView,
      progress,
    });
  } catch (err) {

    log.error(
      {
        operation: 'user.startMachine',
        phase: 'FAILURE',
        rentedInstanceId,
        insertedMachineId,
        provisioningSubscriptionId,
        err: {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
      },
      'START MACHINE FAILURE',
    );

    try {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const dir =
        process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
          ? join('/tmp', 'gpuvietnam')
          : join(process.cwd(), 'tmp');
      mkdirSync(dir, { recursive: true });
      const e = err && typeof err === 'object' ? err : {};
      writeFileSync(
        join(dir, 'last-start-error.json'),
        JSON.stringify(
          {
            at: new Date().toISOString(),
            source: 'user/start-machine',
            message: err instanceof Error ? err.message : String(err),
            code: /** @type {{ code?: string }} */ (e).code ?? null,
            details: /** @type {{ details?: string }} */ (e).details ?? null,
            rentedInstanceId,
            insertedMachineId,
            provisioningSubscriptionId,
          },
          null,
          2,
        ),
      );
    } catch {
      /* ignore diag write failures */
    }



    if (rentedInstanceId && userId && gpuService && provisioningSubscriptionId) {

      try {

        await rollbackProvisionAfterRentFailure(supabaseAdmin, gpuService, {

          userId,

          subscriptionId: provisioningSubscriptionId,

          instanceId: rentedInstanceId,

          machineId: insertedMachineId,

          correlationId,

          reason: 'start_machine_post_rent_failed',

        });

      } catch (rollbackError) {

        console.warn('[user/start-machine] provision rollback failed:', rollbackError);

      }

    } else if (provisioningSubscriptionId) {

      try {

        await updateSubscriptionServerStatus(supabaseAdmin, provisioningSubscriptionId, 'offline');

      } catch (rollbackError) {

        console.warn('[user/start-machine] provisioning rollback failed:', rollbackError);

      }

    }



    return res.status(500).json({
      error: err.message || 'Không khởi động được máy.',
      requestId: correlationId,
    });

  }

}

export default withApiLogging(startMachineHandler, {
  operation: 'user.startMachine',
  channel: 'api',
});

