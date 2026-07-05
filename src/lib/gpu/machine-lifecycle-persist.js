import { executeCommand, MACHINE_COMMAND } from './machine-lifecycle.js';

export async function persistMachineSubscriptionStatus(supabaseAdmin, subscriptionId, machineRecord) {
  if (!machineRecord?.serverStatus) return;
  const { error } = await supabaseAdmin
    .from('subscriptions')
    .update({ server_status: machineRecord.serverStatus })
    .eq('id', subscriptionId);
  if (error) throw error;
}

export function runMachineTransition(record, command, context, payload = {}) {
  return executeCommand(record, command, context, payload);
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
  return runMachineTransitionAndPersist(
    supabaseAdmin,
    subscriptionId,
    record,
    MACHINE_COMMAND.START_REQUESTED,
    context,
    payload,
  );
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
