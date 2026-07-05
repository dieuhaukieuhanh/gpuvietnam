import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const target = path.join(root, 'src/lib/gpu/machine-lifecycle-persist.js');

const content = `/**
 * Machine Lifecycle persistence — command/worker writer path only.
 */

import { executeCommand, MACHINE_COMMAND } from './machine-lifecycle.js';
import { updateSubscriptionServerStatus } from '../machines.js';

export async function persistMachineSubscriptionStatus(supabaseAdmin, subscriptionId, machineRecord) {
  if (!machineRecord?.serverStatus) return;
  await updateSubscriptionServerStatus(supabaseAdmin, subscriptionId, machineRecord.serverStatus);
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
`;

fs.writeFileSync(target, content, 'utf8');
console.log('Wrote', target);
