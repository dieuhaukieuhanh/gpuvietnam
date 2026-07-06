/**
 * Machine Session View — SCB 4.0 projection for API/UI.
 * Pure: no DB, HTTP, or side effects.
 */

import {
  deriveSessionPhase,
  snapshotToMachineRecord,
  MACHINE_LIFECYCLE_STATUS,
  MACHINE_DOMAIN_EVENT,
} from './machine-lifecycle.js';

export { snapshotToMachineRecord };

/**
 * @param {import('./machine-lifecycle.js').MachineRecord|null|undefined} value
 */
function isMachineRecord(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof value.userId === 'string' &&
    typeof value.subscriptionId === 'string' &&
    typeof value.status === 'string'
  );
}

/**
 * @param {import('./machine-lifecycle.js').MachineRecord|null} record
 * @param {{ envName?: string|null; disconnected?: boolean; providerPhase?: string; comfyUrl?: string|null; billingStarted?: boolean; message?: string|null }} options
 */
function buildMachineSessionView(record, options = {}) {
  if (!record) {
    const envName = options.envName ?? null;
    return {
      phase: 'idle',
      lifecycleStatus: MACHINE_LIFECYCLE_STATUS.IDLE,
      serverStatus: 'offline',
      workspace: { name: envName, locked: false },
      machine: null,
      actions: {
        canStart: true,
        canCancel: false,
        canStop: false,
        canOpenComfy: false,
      },
      message: null,
      domainEvent: null,
    };
  }

  const phase = deriveSessionPhase(record, options);
  const envName = options.envName ?? record.envName ?? null;
  const machine = record.machine
    ? {
        id: record.machine.id,
        instanceId: record.machine.instanceId ?? null,
        template: record.machine.template ?? envName,
        status: record.machine.status,
      }
    : null;

  const locked =
    phase === 'opening' ||
    phase === 'stopping' ||
    record.status === MACHINE_LIFECYCLE_STATUS.PROVISIONING;

  const actions = {
    canStart: phase === 'idle' && record.serverStatus === 'offline',
    canCancel:
      phase === 'opening' ||
      (record.status === MACHINE_LIFECYCLE_STATUS.PROVISIONING &&
        record.serverStatus === 'provisioning'),
    canStop:
      phase === 'running' ||
      phase === 'disconnected' ||
      (phase === 'error' && Boolean(machine)) ||
      (Boolean(options.billingStarted) && Boolean(machine)),
    canOpenComfy:
      phase === 'running' && machine?.status === 'running',
  };

  return {
    phase,
    lifecycleStatus: record.status,
    serverStatus: record.serverStatus,
    workspace: { name: envName, locked },
    machine,
    actions,
    message: resolveSessionMessage(phase, record, options),
    domainEvent: resolveDomainEvent(record, phase),
  };
}

/**
 * @param {string} phase
 * @param {import('./machine-lifecycle.js').MachineRecord} record
 * @param {{ message?: string|null }} options
 */
function resolveSessionMessage(phase, record, options) {
  if (options.message != null) return String(options.message);
  switch (phase) {
    case 'opening':
      return 'Đang mở phiên làm việc...';
    case 'stopping':
      return 'Đang đóng phiên làm việc...';
    case 'error':
      return 'Không khởi động được máy. Vui lòng thử lại.';
    case 'disconnected':
      return 'Mất kết nối với máy chủ.';
    case 'running':
      return record.serverStatus === 'online' ? null : 'Đang đồng bộ trạng thái...';
    default:
      return null;
  }
}

/**
 * @param {import('./machine-lifecycle.js').MachineRecord} record
 * @param {string} phase
 */
function resolveDomainEvent(record, phase) {
  if (phase === 'stopping' || record.status === MACHINE_LIFECYCLE_STATUS.STOPPING) {
    return MACHINE_DOMAIN_EVENT.MACHINE_STOPPING;
  }
  if (phase === 'error' || record.status === MACHINE_LIFECYCLE_STATUS.ERROR) {
    return MACHINE_DOMAIN_EVENT.MACHINE_ERROR;
  }
  if (phase === 'running' || record.status === MACHINE_LIFECYCLE_STATUS.RUNNING) {
    return MACHINE_DOMAIN_EVENT.MACHINE_RUNNING;
  }
  if (phase === 'opening' || record.status === MACHINE_LIFECYCLE_STATUS.PROVISIONING) {
    if (record.machine?.status === 'running') return MACHINE_DOMAIN_EVENT.MACHINE_RUNNING;
    return record.machine ? MACHINE_DOMAIN_EVENT.MACHINE_BOOTING : MACHINE_DOMAIN_EVENT.MACHINE_PROVISIONING;
  }
  if (record.status === MACHINE_LIFECYCLE_STATUS.IDLE && record.serverStatus === 'offline') {
    return MACHINE_DOMAIN_EVENT.MACHINE_DESTROYED;
  }
  return null;
}

/**
 * Resolve dashboard/API machine session view from a MachineRecord or raw rows.
 *
 * @param {import('./machine-lifecycle.js').MachineRecord|Record<string, unknown>|null} recordOrSubscription
 * @param {Record<string, unknown>|null|{ envName?: string|null; disconnected?: boolean; providerPhase?: string; comfyUrl?: string|null; message?: string|null }} [machineOrOptions]
 * @param {string} [userId]
 * @param {Record<string, unknown>} [context]
 */
function isViewOptions(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  if ('userId' in value && 'subscriptionId' in value) return false;
  if ('id' in value && 'status' in value && !('envName' in value)) return false;
  return true;
}

export function resolveMachineSessionView(recordOrSubscription, machineOrOptions, userId, context) {
  if (isMachineRecord(recordOrSubscription)) {
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
        : context ?? {};
  const resolvedUserId = typeof userId === 'string' ? userId : String(subscription?.user_id ?? '');
  const record = snapshotToMachineRecord(subscription, machine, resolvedUserId, options);
  const viewOptions = {
    envName: options.envName ?? subscription?.env_name ?? null,
    disconnected: options.disconnected,
    providerPhase: options.providerPhase,
    comfyUrl: options.comfyUrl,
    billingStarted: options.billingStarted,
    message: options.message,
  };
  return buildMachineSessionView(record, viewOptions);
}

export { deriveSessionPhase } from './machine-lifecycle.js';
