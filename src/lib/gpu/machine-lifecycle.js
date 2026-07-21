/**
 * Machine Lifecycle Domain — SCB 4.0.
 * Pure state machine. No DB, HTTP, Supabase, logging, or side effects.
 */

import { isMachineBooting, isRecentBootMachine, shouldCleanupLeakedBootMachine, shouldRepairBootingSubscriptionDrift } from '../machines-provisioning-sync.js';
import { isProjectionTrafficReady } from '../scb-read-path.js';
import { isEndpointResolved } from '../endpoint-utils.js';

export const MACHINE_LIFECYCLE_STATUS = Object.freeze({
  IDLE: 'idle',
  PROVISIONING: 'provisioning',
  RUNNING: 'running',
  STOPPING: 'stopping',
  ERROR: 'error',
});

export const MACHINE_COMMAND = Object.freeze({
  START_REQUESTED: 'START_REQUESTED',
  MACHINE_ROW_INSERTED: 'MACHINE_ROW_INSERTED',
  PROVIDER_STATUS_REPORTED: 'PROVIDER_STATUS_REPORTED',
  STOP_REQUESTED: 'STOP_REQUESTED',
  CANCEL_REQUESTED: 'CANCEL_REQUESTED',
  DESTROY_COMPLETED: 'DESTROY_COMPLETED',
  DRIFT_REPAIR: 'DRIFT_REPAIR',
});

export const MACHINE_DOMAIN_EVENT = Object.freeze({
  START_REQUESTED: 'MachineStartRequested',
  MACHINE_PROVISIONING: 'MachineProvisioning',
  MACHINE_BOOTING: 'MachineBooting',
  MACHINE_RUNNING: 'MachineRunning',
  MACHINE_STOPPING: 'MachineStopping',
  MACHINE_DESTROYED: 'MachineDestroyed',
  MACHINE_ERROR: 'MachineError',
  DRIFT_REPAIRED: 'MachineDriftRepaired',
});

export const MACHINE_ERROR_CODE = Object.freeze({
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  SUBSCRIPTION_NOT_ACTIVE: 'SUBSCRIPTION_NOT_ACTIVE',
  PROVIDER_NOT_VERIFIED: 'PROVIDER_NOT_VERIFIED',
});

export const MACHINE_STATE_MACHINE_VERSION = '1.0';

const BOOTING_STATUSES = new Set(['creating', 'starting']);

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function errorResult(code, message) {
  return { state: 'ERROR', code, message };
}

function okResult(machine, transition, event) {
  return { state: 'OK', machine, transition, event };
}

function ignoredResult(machine) {
  return { state: 'IGNORED', machine, transition: null, event: null };
}

function ctxNow(context) {
  return context.now ?? new Date().toISOString();
}

/** Billing anchor set — lifecycle must not regress to opening when projection TTL expires. */
function isBillingAnchored(machine) {
  return Boolean(machine?.billing_started_at);
}

export function isMachineRowBooting(machine) {
  if (!machine) return false;
  return BOOTING_STATUSES.has(String(machine.status ?? 'creating'));
}

export function deriveLifecycleStatus(subscription, machine, context = {}) {
  const serverStatus = String(subscription?.server_status ?? 'offline');
  const machineStatus = machine ? String(machine.status ?? 'creating') : null;
  if (context.destroyInProgress || serverStatus === 'stopping') return MACHINE_LIFECYCLE_STATUS.STOPPING;
  if (machineStatus === 'error') return MACHINE_LIFECYCLE_STATUS.ERROR;
  if (serverStatus === 'online') {
    if (machine && machineStatus !== 'running') return MACHINE_LIFECYCLE_STATUS.PROVISIONING;
    if (
      machine &&
      machineStatus === 'running' &&
      !isProjectionTrafficReady(machine) &&
      !isBillingAnchored(machine)
    ) {
      // Endpoint already published (e.g. Clore http_pub) — keep UI in running;
      // billing still waits on openBillableSession / live verify.
      if (isEndpointResolved(machine)) return MACHINE_LIFECYCLE_STATUS.RUNNING;
      return MACHINE_LIFECYCLE_STATUS.PROVISIONING;
    }
    return MACHINE_LIFECYCLE_STATUS.RUNNING;
  }
  if (serverStatus === 'provisioning') {
    // Machine row already running with a public endpoint: do not keep the
    // dashboard stuck on the boot checklist until subscription flips online.
    if (
      machine &&
      machineStatus === 'running' &&
      (isBillingAnchored(machine) || isProjectionTrafficReady(machine) || isEndpointResolved(machine))
    ) {
      return MACHINE_LIFECYCLE_STATUS.RUNNING;
    }
    return MACHINE_LIFECYCLE_STATUS.PROVISIONING;
  }
  if (machine && machineStatus !== 'destroyed') {
    if (machineStatus === 'running' && serverStatus === 'online') {
      return MACHINE_LIFECYCLE_STATUS.RUNNING;
    }
    if (machineStatus === 'running' || isMachineRowBooting(machine)) {
      return MACHINE_LIFECYCLE_STATUS.PROVISIONING;
    }
  }
  return MACHINE_LIFECYCLE_STATUS.IDLE;
}

export function snapshotToMachineRecord(subscription, machine, userId, context = {}) {
  if (!subscription) return null;
  const machineSnapshot = machine
    ? {
        id: String(machine.id),
        status: String(machine.status ?? 'creating'),
        instanceId: machine.instance_id != null ? String(machine.instance_id) : null,
        template: machine.template != null ? String(machine.template) : null,
        created_at: machine.created_at != null ? String(machine.created_at) : undefined,
      }
    : null;
  return {
    userId,
    subscriptionId: String(subscription.id),
    status: deriveLifecycleStatus(subscription, machine, context),
    serverStatus: String(subscription.server_status ?? 'offline'),
    envName: subscription.env_name != null ? String(subscription.env_name) : null,
    machine: machineSnapshot,
  };
}

export function deriveSessionPhase(record, options = {}) {
  if (!record) return 'idle';
  if (record.status === MACHINE_LIFECYCLE_STATUS.STOPPING) return 'stopping';
  if (record.status === MACHINE_LIFECYCLE_STATUS.ERROR) return 'error';
  if (options.disconnected || options.providerPhase === 'disconnected') return 'disconnected';
  if (record.status === MACHINE_LIFECYCLE_STATUS.RUNNING) return 'running';
  if (record.status === MACHINE_LIFECYCLE_STATUS.PROVISIONING) return 'opening';
  return 'idle';
}

function runGuards(guardNames, machine, context, payload) {
  for (const guardName of guardNames) {
    const guard = MACHINE_GUARDS[guardName];
    if (!guard) continue;
    const result = guard(machine, context, payload);
    if (!result.ok) return errorResult(result.code, result.message);
  }
  return null;
}

export const MACHINE_GUARDS = Object.freeze({
  subscriptionActive(_machine, context) {
    if (context.subscriptionActive !== true) {
      return { ok: false, code: MACHINE_ERROR_CODE.SUBSCRIPTION_NOT_ACTIVE, message: 'Subscription must be active' };
    }
    return { ok: true };
  },
  providerRunningVerified(_machine, context) {
    if (context.providerRunningVerified !== true) {
      return { ok: false, code: MACHINE_ERROR_CODE.PROVIDER_NOT_VERIFIED, message: 'Provider running state not verified' };
    }
    return { ok: true };
  },
  providerDestroyedVerified(_machine, context) {
    if (context.providerDestroyedVerified !== true) {
      return { ok: false, code: MACHINE_ERROR_CODE.PROVIDER_NOT_VERIFIED, message: 'Provider destroyed state not verified' };
    }
    return { ok: true };
  },
});

const MACHINE_TRANSITION_MAP = [
  {
    transitionId: 'MCH-TR-001',
    from: null,
    command: MACHINE_COMMAND.START_REQUESTED,
    to: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    guards: ['subscriptionActive'],
    event: MACHINE_DOMAIN_EVENT.START_REQUESTED,
    apply(_machine, _context, payload) {
      return {
        userId: String(payload.userId),
        subscriptionId: String(payload.subscriptionId),
        status: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
        serverStatus: 'provisioning',
        envName: payload.envName != null ? String(payload.envName) : null,
        machine: null,
      };
    },
  },
  {
    transitionId: 'MCH-TR-002',
    from: MACHINE_LIFECYCLE_STATUS.IDLE,
    command: MACHINE_COMMAND.START_REQUESTED,
    to: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    guards: ['subscriptionActive'],
    event: MACHINE_DOMAIN_EVENT.MACHINE_PROVISIONING,
    apply(machine, _context, payload) {
      return {
        ...machine,
        status: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
        serverStatus: 'provisioning',
        envName: payload.envName != null ? String(payload.envName) : machine.envName ?? null,
      };
    },
    idempotent(machine) {
      return machine.status === MACHINE_LIFECYCLE_STATUS.PROVISIONING;
    },
  },
  {
    transitionId: 'MCH-TR-003',
    from: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    command: MACHINE_COMMAND.START_REQUESTED,
    to: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    guards: ['subscriptionActive'],
    event: MACHINE_DOMAIN_EVENT.MACHINE_PROVISIONING,
    apply(machine) {
      return machine;
    },
    idempotent() {
      return true;
    },
  },
  {
    transitionId: 'MCH-TR-004',
    from: MACHINE_LIFECYCLE_STATUS.RUNNING,
    command: MACHINE_COMMAND.START_REQUESTED,
    to: MACHINE_LIFECYCLE_STATUS.RUNNING,
    guards: [],
    event: null,
    apply(machine) {
      return machine;
    },
    idempotent() {
      return true;
    },
  },
  {
    transitionId: 'MCH-TR-005',
    from: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    command: MACHINE_COMMAND.MACHINE_ROW_INSERTED,
    to: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    guards: [],
    event: MACHINE_DOMAIN_EVENT.MACHINE_BOOTING,
    apply(machine, context, payload) {
      return {
        ...machine,
        machine: {
          id: String(payload.machineId),
          status: String(payload.status ?? 'creating'),
          instanceId: payload.instanceId != null ? String(payload.instanceId) : null,
          template: payload.template != null ? String(payload.template) : null,
          created_at: payload.created_at ?? ctxNow(context),
        },
      };
    },
    idempotent(machine, _context, payload) {
      return machine.machine?.id === String(payload.machineId);
    },
  },
  {
    transitionId: 'MCH-TR-006',
    from: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    command: MACHINE_COMMAND.PROVIDER_STATUS_REPORTED,
    to: MACHINE_LIFECYCLE_STATUS.RUNNING,
    guards: ['providerRunningVerified'],
    event: MACHINE_DOMAIN_EVENT.MACHINE_RUNNING,
    match(_machine, _context, payload) {
      return payload.providerPhase === 'running';
    },
    apply(machine) {
      return {
        ...machine,
        status: MACHINE_LIFECYCLE_STATUS.RUNNING,
        serverStatus: 'online',
        machine: machine.machine ? { ...machine.machine, status: 'running' } : null,
      };
    },
    idempotent(machine) {
      return machine.status === MACHINE_LIFECYCLE_STATUS.RUNNING;
    },
  },
  {
    transitionId: 'MCH-TR-007',
    from: MACHINE_LIFECYCLE_STATUS.RUNNING,
    command: MACHINE_COMMAND.PROVIDER_STATUS_REPORTED,
    to: MACHINE_LIFECYCLE_STATUS.RUNNING,
    guards: [],
    event: MACHINE_DOMAIN_EVENT.MACHINE_RUNNING,
    match(_machine, _context, payload) {
      return payload.providerPhase === 'running';
    },
    apply(machine) {
      return machine;
    },
    idempotent() {
      return true;
    },
  },
  {
    transitionId: 'MCH-TR-008',
    from: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    command: MACHINE_COMMAND.PROVIDER_STATUS_REPORTED,
    to: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    guards: [],
    event: MACHINE_DOMAIN_EVENT.MACHINE_BOOTING,
    match(_machine, _context, payload) {
      return payload.providerPhase === 'creating' || payload.providerPhase === 'starting';
    },
    apply(machine, _context, payload) {
      if (!machine.machine) return machine;
      return { ...machine, machine: { ...machine.machine, status: String(payload.providerPhase) } };
    },
  },
  {
    transitionId: 'MCH-TR-009',
    from: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    command: MACHINE_COMMAND.PROVIDER_STATUS_REPORTED,
    to: MACHINE_LIFECYCLE_STATUS.ERROR,
    guards: [],
    event: MACHINE_DOMAIN_EVENT.MACHINE_ERROR,
    match(_machine, _context, payload) {
      return payload.providerPhase === 'error';
    },
    apply(machine) {
      return {
        ...machine,
        status: MACHINE_LIFECYCLE_STATUS.ERROR,
        machine: machine.machine ? { ...machine.machine, status: 'error' } : machine.machine,
      };
    },
  },
  {
    transitionId: 'MCH-TR-010',
    from: MACHINE_LIFECYCLE_STATUS.RUNNING,
    command: MACHINE_COMMAND.STOP_REQUESTED,
    to: MACHINE_LIFECYCLE_STATUS.STOPPING,
    guards: [],
    event: MACHINE_DOMAIN_EVENT.MACHINE_STOPPING,
    apply(machine) {
      return { ...machine, status: MACHINE_LIFECYCLE_STATUS.STOPPING, serverStatus: 'stopping' };
    },
    idempotent(machine) {
      return machine.status === MACHINE_LIFECYCLE_STATUS.STOPPING;
    },
  },
  {
    transitionId: 'MCH-TR-011',
    from: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    command: MACHINE_COMMAND.CANCEL_REQUESTED,
    to: MACHINE_LIFECYCLE_STATUS.STOPPING,
    guards: [],
    event: MACHINE_DOMAIN_EVENT.MACHINE_STOPPING,
    apply(machine) {
      return { ...machine, status: MACHINE_LIFECYCLE_STATUS.STOPPING };
    },
    idempotent(machine) {
      return machine.status === MACHINE_LIFECYCLE_STATUS.STOPPING;
    },
  },
  {
    transitionId: 'MCH-TR-012',
    from: MACHINE_LIFECYCLE_STATUS.STOPPING,
    command: MACHINE_COMMAND.DESTROY_COMPLETED,
    to: MACHINE_LIFECYCLE_STATUS.IDLE,
    guards: ['providerDestroyedVerified'],
    event: MACHINE_DOMAIN_EVENT.MACHINE_DESTROYED,
    apply(machine) {
      return { ...machine, status: MACHINE_LIFECYCLE_STATUS.IDLE, serverStatus: 'offline', machine: null };
    },
    idempotent(machine) {
      return machine.status === MACHINE_LIFECYCLE_STATUS.IDLE;
    },
  },
  {
    transitionId: 'MCH-TR-013',
    from: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    command: MACHINE_COMMAND.DESTROY_COMPLETED,
    to: MACHINE_LIFECYCLE_STATUS.IDLE,
    guards: [],
    event: MACHINE_DOMAIN_EVENT.MACHINE_DESTROYED,
    apply(machine) {
      return { ...machine, status: MACHINE_LIFECYCLE_STATUS.IDLE, serverStatus: 'offline', machine: null };
    },
    idempotent(machine) {
      return machine.status === MACHINE_LIFECYCLE_STATUS.IDLE;
    },
  },
  {
    transitionId: 'MCH-TR-014',
    from: MACHINE_LIFECYCLE_STATUS.IDLE,
    command: MACHINE_COMMAND.DESTROY_COMPLETED,
    to: MACHINE_LIFECYCLE_STATUS.IDLE,
    guards: [],
    event: null,
    apply(machine) {
      return machine;
    },
    idempotent() {
      return true;
    },
  },
  {
    transitionId: 'MCH-TR-015',
    from: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    command: MACHINE_COMMAND.DRIFT_REPAIR,
    to: MACHINE_LIFECYCLE_STATUS.RUNNING,
    guards: [],
    event: MACHINE_DOMAIN_EVENT.DRIFT_REPAIRED,
    match(_machine, _context, payload) {
      return payload.repairAction === 'promote_online';
    },
    apply(machine) {
      return {
        ...machine,
        status: MACHINE_LIFECYCLE_STATUS.RUNNING,
        serverStatus: 'online',
        machine: machine.machine ? { ...machine.machine, status: 'running' } : machine.machine,
      };
    },
    idempotent(machine) {
      return machine.status === MACHINE_LIFECYCLE_STATUS.RUNNING;
    },
  },
  {
    transitionId: 'MCH-TR-016',
    from: MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    command: MACHINE_COMMAND.DRIFT_REPAIR,
    to: MACHINE_LIFECYCLE_STATUS.IDLE,
    guards: [],
    event: MACHINE_DOMAIN_EVENT.DRIFT_REPAIRED,
    match(_machine, _context, payload) {
      return payload.repairAction === 'reset_idle';
    },
    apply(machine) {
      return { ...machine, status: MACHINE_LIFECYCLE_STATUS.IDLE, serverStatus: 'offline', machine: null };
    },
    idempotent(machine) {
      return machine.status === MACHINE_LIFECYCLE_STATUS.IDLE;
    },
  },
  {
    transitionId: 'MCH-TR-017',
    from: MACHINE_LIFECYCLE_STATUS.RUNNING,
    command: MACHINE_COMMAND.DRIFT_REPAIR,
    to: MACHINE_LIFECYCLE_STATUS.IDLE,
    guards: [],
    event: MACHINE_DOMAIN_EVENT.DRIFT_REPAIRED,
    match(_machine, _context, payload) {
      return payload.repairAction === 'reset_idle';
    },
    apply(machine) {
      return { ...machine, status: MACHINE_LIFECYCLE_STATUS.IDLE, serverStatus: 'offline', machine: null };
    },
  },
  {
    transitionId: 'MCH-TR-018',
    from: MACHINE_LIFECYCLE_STATUS.IDLE,
    command: MACHINE_COMMAND.DRIFT_REPAIR,
    to: MACHINE_LIFECYCLE_STATUS.IDLE,
    guards: [],
    event: MACHINE_DOMAIN_EVENT.DRIFT_REPAIRED,
    match(_machine, _context, payload) {
      return payload.repairAction === 'reset_idle';
    },
    apply(machine) {
      return machine;
    },
    idempotent() {
      return true;
    },
  },
];

deepFreeze(MACHINE_TRANSITION_MAP);

export function findTransitions(from, command) {
  return MACHINE_TRANSITION_MAP.filter((def) => def.from === from && def.command === command);
}

export function getTransitionMap() {
  return MACHINE_TRANSITION_MAP;
}

function currentStatus(machine) {
  return machine?.status ?? null;
}

export function executeCommand(machine, command, context, payload = {}) {
  const from = currentStatus(machine);
  const candidates = findTransitions(from, command);
  if (candidates.length === 0) {
    return errorResult(MACHINE_ERROR_CODE.INVALID_TRANSITION, `No transition for status=${from ?? 'null'} command=${command}`);
  }
  const matched = candidates.filter((def) => !def.match || def.match(machine, context, payload));
  if (matched.length === 0) {
    return errorResult(MACHINE_ERROR_CODE.INVALID_TRANSITION, `No matching transition for status=${from ?? 'null'} command=${command}`);
  }
  const definition = matched[0];
  if (machine && definition.idempotent?.(machine, context, payload)) {
    if (definition.to && machine.status === definition.to) return ignoredResult(machine);
    if (definition.event === null && definition.idempotent(machine, context, payload)) return ignoredResult(machine);
  }
  const guardError = runGuards(definition.guards, machine, context, payload);
  if (guardError) return guardError;
  if (machine && definition.idempotent?.(machine, context, payload)) {
    if (definition.to && machine.status === definition.to) return ignoredResult(machine);
  }
  const nextMachine = definition.apply(machine, context, payload);
  return okResult(nextMachine, { from, to: definition.to ?? nextMachine.status, command }, definition.event);
}

export function requestStartMachine(input, context) {
  return executeCommand(null, MACHINE_COMMAND.START_REQUESTED, context, input);
}

export function requestStopMachine(machine, context, payload = {}) {
  return executeCommand(machine, MACHINE_COMMAND.STOP_REQUESTED, context, payload);
}

export function requestCancelMachine(machine, context) {
  return executeCommand(machine, MACHINE_COMMAND.CANCEL_REQUESTED, context, {});
}

export function completeDestroyMachine(machine, context) {
  return executeCommand(machine, MACHINE_COMMAND.DESTROY_COMPLETED, context, {});
}

export function reportProviderStatus(machine, context, payload) {
  return executeCommand(machine, MACHINE_COMMAND.PROVIDER_STATUS_REPORTED, context, payload);
}

export function applyDriftRepair(machine, context, repairAction) {
  return executeCommand(machine, MACHINE_COMMAND.DRIFT_REPAIR, context, { repairAction });
}

export function detectDriftRepair(subscription, machine, nowMs = Date.now()) {
  if (!subscription) return null;
  if (machine && shouldCleanupLeakedBootMachine(machine, subscription.server_status, nowMs)) {
    return { repairAction: 'mark_destroyed', repairKind: 'mark_destroyed_local', reason: 'reset_stale_provisioning_boot' };
  }
  if (machine && subscription.server_status === 'offline') {
    // Hour top-up / extra combo often creates a newer offline subscription while an
    // older online subscription still owns the running machine. That is not a leak.
    const machineSubId =
      machine.subscription_id != null ? String(machine.subscription_id) : null;
    if (machineSubId && machineSubId !== String(subscription.id)) {
      return null;
    }
    if (shouldRepairBootingSubscriptionDrift(machine, subscription.server_status, nowMs)) {
      return {
        repairAction: 'promote_provisioning',
        repairKind: 'update_subscription',
        reason: 'repaired_booting_subscription',
      };
    }
    if (isMachineBooting(machine) && isRecentBootMachine(machine, nowMs)) {
      return null;
    }
    return { repairAction: 'destroy_machine', repairKind: 'destroy_user_machine', reason: 'destroyed_leaked_machine' };
  }
  if (machine && subscription.server_status === 'provisioning') {
    const machineStatus = String(machine.status ?? 'creating');
    if (machineStatus === 'running' && isProjectionTrafficReady(machine)) {
      return { repairAction: 'promote_online', repairKind: 'update_subscription', reason: 'repaired_provisioning_to_online' };
    }
    if (!isMachineBooting(machine) && machineStatus !== 'running') {
      return { repairAction: 'mark_destroyed', repairKind: 'mark_destroyed_local', reason: 'destroyed_leaked_provisioning_machine' };
    }
  }
  if (!machine) {
    if (subscription.server_status === 'online') {
      return { repairAction: 'reset_idle', repairKind: 'update_subscription', reason: 'reset_orphan_online' };
    }
    return null;
  }
  if (machine && !machine.instance_id) {
    if (isMachineBooting(machine) && isRecentBootMachine(machine, nowMs)) {
      return null;
    }
    return { repairAction: 'mark_destroyed', repairKind: 'mark_destroyed_local', reason: 'reset_invalid_machine_row' };
  }
  return null;
}
