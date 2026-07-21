import { executeCommand, MACHINE_COMMAND } from './machine-lifecycle.js';
import { claimSubscriptionForProvision } from '../machines-provision-claim.js';
import { clearedProvisionLeaseFields } from '../provision-lease.js';
import { logScbTransition } from '../logging/scb-transition.js';

export async function persistMachineSubscriptionStatus(supabaseAdmin, subscriptionId, machineRecord) {
  if (!machineRecord?.serverStatus) return;
  /** @type {Record<string, unknown>} */
  const patch = { server_status: machineRecord.serverStatus };
  if (machineRecord.serverStatus !== 'provisioning') {
    Object.assign(patch, clearedProvisionLeaseFields());
  }
  const { error } = await supabaseAdmin
    .from('subscriptions')
    .update(patch)
    .eq('id', subscriptionId);
  if (error) throw error;
}

/**
 * @param {unknown} record
 * @param {string} command
 * @param {unknown} context
 * @param {Record<string, unknown>} [payload]
 */
export function runMachineTransition(record, command, context, payload = {}) {
  const stateBefore =
    record && typeof record === 'object'
      ? /** @type {{ status?: string|null }} */ (record).status ?? null
      : null;
  const result = executeCommand(record, command, context, payload);
  const stateAfter =
    result.machine && typeof result.machine === 'object'
      ? /** @type {{ status?: string|null }} */ (result.machine).status ?? null
      : result.transition?.to ?? null;

  logScbTransition({
    command,
    resultState: result.state ?? null,
    stateBefore: result.transition?.from ?? stateBefore,
    stateAfter: result.transition?.to ?? stateAfter,
    gpuSessionId:
      payload.gpuSessionId != null
        ? String(payload.gpuSessionId)
        : record && typeof record === 'object' && /** @type {any} */ (record).sessionId != null
          ? String(/** @type {any} */ (record).sessionId)
          : null,
    machineOperationId:
      payload.machineOperationId != null ? String(payload.machineOperationId) : null,
    machineId:
      payload.machineId != null
        ? String(payload.machineId)
        : result.machine?.machineId != null
          ? String(result.machine.machineId)
          : result.machine?.id != null
            ? String(result.machine.id)
            : null,
    projectionVersion: payload.projectionVersion ?? null,
    settlementVersion: payload.settlementVersion ?? null,
    event: result.event ?? null,
  });

  return result;
}

export async function runMachineTransitionAndPersist(
  supabaseAdmin,
  subscriptionId,
  record,
  command,
  context,
  payload = {},
) {
  const result = runMachineTransition(record, command, context, payload);
  if (result.state === 'OK' && result.machine) {
    await persistMachineSubscriptionStatus(supabaseAdmin, subscriptionId, result.machine);
  }
  return result;
}

export async function persistStartRequested(supabaseAdmin, subscriptionId, record, context, payload) {
  const result = runMachineTransition(record, MACHINE_COMMAND.START_REQUESTED, context, payload);
  if (result.state !== 'OK' || !result.machine) {
    return result;
  }

  const wasProvisioning = record?.serverStatus === 'provisioning';
  const nextStatus = result.machine.serverStatus;

  if (nextStatus === 'provisioning' && !wasProvisioning) {
    const claimed = await claimSubscriptionForProvision(supabaseAdmin, subscriptionId, {
      plan: payload.plan != null ? String(payload.plan) : undefined,
      gpu_label: payload.gpuLabel != null ? String(payload.gpuLabel) : undefined,
      requestId: payload.correlationId != null ? String(payload.correlationId) : undefined,
      ownerId: payload.leaseOwnerId != null ? String(payload.leaseOwnerId) : undefined,
    });
    if (!claimed) {
      return { state: 'IGNORED', machine: result.machine, transition: null, event: null };
    }
    return { ...result, claimed };
  }

  if (nextStatus) {
    await persistMachineSubscriptionStatus(supabaseAdmin, subscriptionId, result.machine);
  }
  return result;
}

export async function persistStopRequested(supabaseAdmin, subscriptionId, record, context) {
  return runMachineTransitionAndPersist(
    supabaseAdmin,
    subscriptionId,
    record,
    MACHINE_COMMAND.STOP_REQUESTED,
    context,
    {},
  );
}

export async function persistDestroyCompleted(supabaseAdmin, subscriptionId, record, context) {
  return runMachineTransitionAndPersist(
    supabaseAdmin,
    subscriptionId,
    record,
    MACHINE_COMMAND.DESTROY_COMPLETED,
    context,
    {},
  );
}

export async function persistProviderRunning(supabaseAdmin, subscriptionId, record, context) {
  return runMachineTransitionAndPersist(
    supabaseAdmin,
    subscriptionId,
    record,
    MACHINE_COMMAND.PROVIDER_STATUS_REPORTED,
    { ...context, providerRunningVerified: true },
    { providerPhase: 'running' },
  );
}

export async function persistDriftRepair(supabaseAdmin, subscriptionId, record, context, repairAction) {
  return runMachineTransitionAndPersist(
    supabaseAdmin,
    subscriptionId,
    record,
    MACHINE_COMMAND.DRIFT_REPAIR,
    context,
    { repairAction },
  );
}
