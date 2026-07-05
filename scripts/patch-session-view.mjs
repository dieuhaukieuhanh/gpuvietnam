import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = path.join(root, 'src/lib/gpu/machine-session-view.js');
let s = fs.readFileSync(p, 'utf8');

if (!s.includes('isViewOptions')) {
  s = s.replace(
    'export function resolveMachineSessionView(recordOrSubscription, machineOrOptions, userId, context) {',
    `function isViewOptions(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  if ('userId' in value && 'subscriptionId' in value) return false;
  if ('id' in value && 'status' in value && !('envName' in value)) return false;
  return true;
}

export function resolveMachineSessionView(recordOrSubscription, machineOrOptions, userId, context) {`,
  );
  s = s.replace(
    `  if (isMachineRecord(recordOrSubscription)) {
    return buildMachineSessionView(recordOrSubscription, machineOrOptions ?? {});
  }

  const subscription = recordOrSubscription;
  const machine = machineOrOptions ?? null;
  const options =
    typeof userId === 'object' && userId != null && !Array.isArray(userId)
      ? userId
      : context ?? {};`,
    `  if (isMachineRecord(recordOrSubscription)) {
    return buildMachineSessionView(recordOrSubscription, machineOrOptions ?? {});
  }

  if (recordOrSubscription == null && userId === undefined && isViewOptions(machineOrOptions)) {
    return buildMachineSessionView(null, machineOrOptions ?? {});
  }

  const subscription = recordOrSubscription;
  const machine = isViewOptions(machineOrOptions) ? null : machineOrOptions ?? null;
  const options =
    typeof userId === 'object' && userId != null && !Array.isArray(userId)
      ? userId
      : isViewOptions(machineOrOptions)
        ? machineOrOptions
        : context ?? {};`,
  );
  fs.writeFileSync(p, s, 'utf8');
  console.log('patched machine-session-view.js');
} else {
  console.log('already patched');
}
