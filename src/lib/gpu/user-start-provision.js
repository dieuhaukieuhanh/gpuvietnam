import {
  formatGpuUserMessage,
  getGpuService,
  getGpuServiceForMachine,
  provisionGpuInstance,
  createProvisioningPendingSession,
  snapshotToMachineRecord,
  persistProviderRunning,
  persistMachineSubscriptionStatus,
  MACHINE_COMMAND,
  runMachineTransition,
} from '@/lib/gpu';
import { GPUProviderError } from '@/lib/gpu/gpu-errors';
import { getGpuLabel } from '@/lib/gpu-pricing';
import {
  insertMachineRecord,
  mapGpuInstanceToMachineRow,
  resolveLiveMachineStatus,
  rollbackProvisionAfterRentFailure,
  syncMachineFromLiveStatus,
} from '@/lib/machines';
import { recoverRentedInstance } from '@/lib/gpu/provision-recover';
import {
  rememberHostFailure,
  rememberHostSuccess,
  resolveCloreHostKey,
  resolveVastHostKey,
  withGpuLine,
} from '@/lib/gpu/host-reputation/index.js';
import {
  setProvisionProgress,
  PROVISION_STAGE,
} from '@/lib/provision-progress/index.js';
import { logger, logPhase, updateLogContext } from '../logging/index.js';
import { ProvisionLeaseHandle } from '../provision-lease.js';

/**
 * @param {Record<string, unknown> | null | undefined} instance
 * @param {string | null | undefined} [gpuLine]
 * @returns {string | null}
 */
function resolveProvisionHostKey(instance, gpuLine = null) {
  if (!instance || typeof instance !== 'object') return null;
  const selection =
    instance.gpuvietnam_selection && typeof instance.gpuvietnam_selection === 'object'
      ? /** @type {Record<string, unknown>} */ (instance.gpuvietnam_selection)
      : null;
  const line =
    gpuLine ||
    (selection?.gpu_line != null ? String(selection.gpu_line) : null) ||
    null;
  if (selection?.host_key != null && String(selection.host_key).trim()) {
    const rawKey = String(selection.host_key).trim();
    // Ensure GPU-line scope even if older selection meta omitted it
    return withGpuLine(rawKey, line) || rawKey;
  }
  const provider = String(instance.providerId ?? instance.provider ?? '').toLowerCase();
  if (provider === 'clore') {
    return resolveCloreHostKey(instance, selection?.offer_id ?? instance.offer_id ?? null, line);
  }
  if (provider === 'vast') {
    return resolveVastHostKey(instance, line);
  }
  return (
    resolveCloreHostKey(instance, selection?.offer_id ?? null, line) ||
    resolveVastHostKey(instance, line)
  );
}

/**
 * Background provider rent + machine row after start-machine returned opening view to client.
 * Level 1 routing (Vast primary, Clore secondary) lives in provisionGpuInstance.
 */
export async function completeUserStartProvision(supabaseAdmin, params) {
  const {
    userId,
    subscriptionId,
    subscription,
    selected,
    planKey,
    planName,
    gpuLine,
    envName,
    workstationContainerEnv,
    backupTokenId,
    lifecycleCtx,
    correlationId,
    provisionLabel,
  } = params;

  const log = logger('api');
  const started = Date.now();
  updateLogContext({
    requestId: correlationId,
    userId,
    subscriptionId,
    operation: 'user.startProvision',
    channel: 'api',
  });
  logPhase('user.startProvision', 'START', {
    channel: 'api',
    requestId: correlationId,
    userId,
    subscriptionId,
    meta: { planKey, gpuLine, envName },
  });

  /** Default service until we know which marketplace rented the instance. */
  let gpuService = getGpuService();
  let rentedInstanceId = null;
  let insertedMachineId = null;
  const label =
    provisionLabel ||
    `gv-${String(userId).replace(/-/g, '').slice(0, 8)}-${String(subscriptionId).replace(/-/g, '').slice(0, 8)}-${String(correlationId ?? '').replace(/-/g, '').slice(0, 8)}`.slice(0, 64);


  const leaseId = subscription?.provisioning_lease_id
    ? String(subscription.provisioning_lease_id)
    : null;
  const leaseOwner = subscription?.provisioning_lease_owner
    ? String(subscription.provisioning_lease_owner)
    : null;
  /** @type {import('../provision-lease.js').ProvisionLeaseHandle | null} */
  let lease = null;
  if (leaseId) {
    lease = new ProvisionLeaseHandle({
      supabaseAdmin,
      subscriptionId,
      leaseId,
      ownerId: leaseOwner || 'unknown',
      requestId: correlationId,
      provider: 'clore',
    });
    lease.startAutoRenew();
    await lease.heartbeat('provision_start');
  }

  await setProvisionProgress(subscriptionId, {
    stage: PROVISION_STAGE.CHECKING_ACCOUNT,
    tick: 'provision_start',
    requestId: correlationId,
    gpuType: gpuLine,
    supabaseAdmin,
  });

  const onProgress = async (step, meta = {}) => {
    await setProvisionProgress(subscriptionId, {
      tick: step,
      message: meta?.message ?? undefined,
      requestId: correlationId,
      gpuType: gpuLine,
      provider: lease?.provider ?? gpuService?.getProviderInfo?.()?.id ?? null,
      machineId: rentedInstanceId,
      supabaseAdmin,
    });
    if (!lease) return;
    const ok = await lease.onProgress(step);
    if (!ok) {
      throw new Error('Provision lease lost - another worker reclaimed this claim');
    }
  };

  /** @type {Record<string, unknown> | null} */
  let provisionedInstance = null;

  try {
    let instance = await provisionGpuInstance(gpuService, {
      gpuLine,
      plan: planKey,
      label,
      env: workstationContainerEnv,
      onProgress,
    });

    if (!instance?.id) {
      const recovered = await recoverRentedInstance(label, gpuLine, { requestId: correlationId });
      if (recovered?.id) {
        instance = recovered;
      } else {
        await persistMachineSubscriptionStatus(supabaseAdmin, subscriptionId, { serverStatus: 'offline' });
        log.error(
          {
            operation: 'user.startProvision',
            phase: 'FAILURE',
            label,
            durationMs: Date.now() - started,
          },
          'Provider returned no instance id; label recovery failed',
        );
        // Must throw — silent return marked the durable op "completed" with no GPU.
        throw new GPUProviderError(
          'Không thuê được máy GPU (không có instance id). Thử mở lại.',
          { operation: 'user.startProvision', retryable: true },
        );
      }
    }

    provisionedInstance = /** @type {Record<string, unknown>} */ (instance);
    rentedInstanceId = String(instance.id);
    updateLogContext({ machineId: rentedInstanceId });
    if (lease) {
      lease.provider = instance.providerId ?? lease.provider;
      lease.machineId = rentedInstanceId;
      await onProgress('instance_rented');
    } else {
      await setProvisionProgress(subscriptionId, {
        tick: 'instance_rented',
        requestId: correlationId,
        provider: instance.providerId ?? null,
        gpuType: gpuLine,
        machineId: rentedInstanceId,
        hostId:
          instance?.gpuvietnam_selection?.host_key != null
            ? String(instance.gpuvietnam_selection.host_key)
            : null,
        supabaseAdmin,
      });
    }
    const machineRow = mapGpuInstanceToMachineRow(instance, {
      gpuLine,
      region: instance.region,
      subscriptionId,
      template: envName,
    });
    const flushSecret =
      workstationContainerEnv &&
      typeof workstationContainerEnv.GPUVIETNAM_BACKUP_FLUSH_SECRET === 'string'
        ? workstationContainerEnv.GPUVIETNAM_BACKUP_FLUSH_SECRET.trim()
        : '';
    if (flushSecret) {
      machineRow.backup_flush_secret = flushSecret;
    }

    try {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const dir =
        process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
          ? join('/tmp', 'gpuvietnam')
          : join(process.cwd(), 'tmp');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'last-start-progress.json'),
        JSON.stringify(
          {
            at: new Date().toISOString(),
            phase: 'rented',
            requestId: correlationId,
            provider: instance.providerId ?? null,
            instanceId: rentedInstanceId,
            label,
            port: machineRow.port ?? null,
            ip: machineRow.ip_address ?? null,
            planKey,
            gpuLine,
            image: machineRow.image ?? null,
            failover: /** @type {{ gpuvietnam_failover?: unknown }} */ (instance).gpuvietnam_failover ?? null,
          },
          null,
          2,
        ),
      );
    } catch {
      /* ignore */
    }

    await onProgress('machine_insert');
    const machine = await insertMachineRecord(supabaseAdmin, userId, machineRow);
    insertedMachineId = machine.id;
    if (params.backupTokenId) {
      try {
        const { attachBackupTokenToMachine } = await import('@/lib/machine-backup-token');
        await attachBackupTokenToMachine(supabaseAdmin, params.backupTokenId, machine.id);
      } catch (attachErr) {
        console.warn(
          '[user-start-provision] attachBackupTokenToMachine failed:',
          attachErr instanceof Error ? attachErr.message : attachErr,
        );
      }
    }
    if (lease) lease.machineId = machine.id != null ? String(machine.id) : rentedInstanceId;
    gpuService = getGpuServiceForMachine(machine);
    await onProgress('machine_created');

    runMachineTransition(
      snapshotToMachineRecord(subscription, null, userId),
      MACHINE_COMMAND.MACHINE_ROW_INSERTED,
      lifecycleCtx,
      {
        machineId: machine.id,
        instanceId: machine.instance_id,
        status: machine.status,
        template: envName,
        created_at: machine.created_at,
      },
    );

    await onProgress('session_create');
    await createProvisioningPendingSession(supabaseAdmin, {
      userId,
      machine,
      subscription,
      template: envName,
      plan: planName,
      billing: subscription.billing ?? selected.billing ?? 'combo1',
      gpuConfig: getGpuLabel(planKey),
    });

    await onProgress('status_poll');
    const liveStatus = await resolveLiveMachineStatus(gpuService, machine);
    const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, machine, liveStatus);
    await onProgress(liveStatus.status === 'running' ? 'comfy_ready' : 'health_check');

    // Do not leave subscription stuck in provisioning after a terminal boot error.
    if (liveStatus.status === 'error') {
      throw new Error(
        liveStatus.message
          ? String(liveStatus.message)
          : 'GPU boot failed after rent',
      );
    }

    if (liveStatus.status === 'running') {
      await persistProviderRunning(
        supabaseAdmin,
        subscriptionId,
        snapshotToMachineRecord(subscription, syncedMachine, userId),
        lifecycleCtx,
      );
      await setProvisionProgress(subscriptionId, {
        stage: PROVISION_STAGE.RUNNING,
        tick: 'comfy_ready',
        requestId: correlationId,
        provider: instance.providerId ?? null,
        gpuType: gpuLine,
        machineId: rentedInstanceId,
        supabaseAdmin,
      });
      const hostKey = resolveProvisionHostKey(
        /** @type {Record<string, unknown>} */ (instance),
        gpuLine,
      );
      if (hostKey) {
        rememberHostSuccess(hostKey, {
          requestId: correlationId,
          gpuType: gpuLine,
          gpuLine,
          region: instance.region != null ? String(instance.region) : null,
          readyLatencyMs: Date.now() - started,
        });
      }

      // Smart Restore Level 1 — best-effort after Comfy ready (does not fail provision).
      try {
        const { maybeSmartRestoreAfterReady } = await import(
          '@/lib/workspace-restore/index.js'
        );
        await maybeSmartRestoreAfterReady(supabaseAdmin, {
          userId,
          subscriptionId: String(subscriptionId),
          machine: syncedMachine ?? machine,
          requestId: correlationId,
        });
      } catch (restoreErr) {
        log.warn('workspace restore after ready failed', {
          err: restoreErr,
        });
      }
    }

    lease?.release('provision_success');
    lease = null;

    logPhase('user.startProvision', 'SUCCESS', {
      channel: 'api',
      requestId: correlationId,
      userId,
      machineId: rentedInstanceId,
      subscriptionId,
      durationMs: Date.now() - started,
      meta: {
        provider: instance.providerId ?? null,
        insertedMachineId,
        label,
      },
    });
  } catch (gpuError) {
    logPhase('user.startProvision', 'FAILURE', {
      channel: 'api',
      requestId: correlationId,
      userId,
      machineId: rentedInstanceId,
      subscriptionId,
      durationMs: Date.now() - started,
      err: gpuError,
      meta: { planKey, gpuLine, label },
    });

    try {
      await setProvisionProgress(subscriptionId, {
        stage: PROVISION_STAGE.FAILED,
        tick: 'failed',
        requestId: correlationId,
        gpuType: gpuLine,
        machineId: rentedInstanceId,
        message: gpuError instanceof Error ? gpuError.message : String(gpuError),
        supabaseAdmin,
      });
    } catch {
      /* ignore */
    }

    try {
      const hostKey = resolveProvisionHostKey(provisionedInstance, gpuLine);
      if (hostKey) {
        rememberHostFailure(hostKey, {
          error: gpuError,
          phase: 'health',
          requestId: correlationId,
          gpuType: gpuLine,
          gpuLine,
          region:
            provisionedInstance?.region != null
              ? String(provisionedInstance.region)
              : null,
        });
      }
    } catch {
      /* ignore reputation errors */
    }

    if (!rentedInstanceId && label) {
      try {
        const recovered = await recoverRentedInstance(label, gpuLine, { requestId: correlationId });
        if (recovered?.id) {
          rentedInstanceId = String(recovered.id);
          log.warn(
            { operation: 'user.startProvision', label, instanceId: rentedInstanceId },
            'Recovered orphan after rent error',
          );
        }
      } catch {
        /* ignore recovery errors */
      }
    }

    try {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const dir =
        process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
          ? join('/tmp', 'gpuvietnam')
          : join(process.cwd(), 'tmp');
      mkdirSync(dir, { recursive: true });
      const err = gpuError && typeof gpuError === 'object' ? gpuError : {};
      writeFileSync(
        join(dir, 'last-start-error.json'),
        JSON.stringify(
          {
            at: new Date().toISOString(),
            source: 'user-start-provision',
            requestId: correlationId,
            message: gpuError instanceof Error ? gpuError.message : String(gpuError),
            code: /** @type {{ code?: string }} */ (err).code ?? null,
            details: /** @type {{ details?: string }} */ (err).details ?? null,
            hint: /** @type {{ hint?: string }} */ (err).hint ?? null,
            rentedInstanceId,
            insertedMachineId,
            subscriptionId,
            planKey,
            gpuLine,
            label,
            provider: gpuService?.getProviderInfo?.()?.id ?? null,
          },
          null,
          2,
        ),
      );
    } catch {
      /* ignore diag write failures */
    }
    if (rentedInstanceId) {
      try {
        await rollbackProvisionAfterRentFailure(supabaseAdmin, gpuService, {
          userId,
          subscriptionId,
          instanceId: rentedInstanceId,
          machineId: insertedMachineId,
          correlationId,
          reason: 'start_machine_post_rent_failed',
        });
      } catch (rollbackError) {
        log.warn(
          {
            operation: 'user.startProvision.rollback',
            err: {
              message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
            },
          },
          'rollback failed',
        );
      }
    } else {
      try {
        await persistMachineSubscriptionStatus(supabaseAdmin, subscriptionId, { serverStatus: 'offline' });
      } catch (rollbackError) {
        log.warn(
          {
            operation: 'user.startProvision.rollback',
            err: {
              message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
            },
          },
          'offline rollback failed',
        );
      }
    }
    lease?.stopAutoRenew();
    void formatGpuUserMessage(gpuError);
  } finally {
    lease?.stopAutoRenew();
  }
}
