import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function write(rel, content) {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf8');
  console.log('wrote', rel);
}

write('src/lib/gpu/machine-session-view.js', `/**
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
 * @param {{ envName?: string|null; disconnected?: boolean; providerPhase?: string; comfyUrl?: string|null }} options
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
      (phase === 'error' && Boolean(machine)),
    canOpenComfy:
      phase === 'running' &&
      Boolean(options.comfyUrl) &&
      machine?.status === 'running',
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
export function resolveMachineSessionView(recordOrSubscription, machineOrOptions, userId, context) {
  if (isMachineRecord(recordOrSubscription)) {
    return buildMachineSessionView(recordOrSubscription, machineOrOptions ?? {});
  }

  const subscription = recordOrSubscription;
  const machine = machineOrOptions ?? null;
  const options =
    typeof userId === 'object' && userId != null && !Array.isArray(userId)
      ? userId
      : context ?? {};
  const resolvedUserId = typeof userId === 'string' ? userId : String(subscription?.user_id ?? '');
  const record = snapshotToMachineRecord(subscription, machine, resolvedUserId, options);
  const viewOptions = {
    envName: options.envName ?? subscription?.env_name ?? null,
    disconnected: options.disconnected,
    providerPhase: options.providerPhase,
    comfyUrl: options.comfyUrl,
    message: options.message,
  };
  return buildMachineSessionView(record, viewOptions);
}

export { deriveSessionPhase } from './machine-lifecycle.js';
`);

write('src/lib/gpu/machine-lifecycle.test.mjs', `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import {
  MACHINE_COMMAND,
  MACHINE_DOMAIN_EVENT,
  MACHINE_ERROR_CODE,
  MACHINE_LIFECYCLE_STATUS,
  MACHINE_STATE_MACHINE_VERSION,
  applyDriftRepair,
  completeDestroyMachine,
  deriveLifecycleStatus,
  deriveSessionPhase,
  detectDriftRepair,
  executeCommand,
  findTransitions,
  getTransitionMap,
  isMachineRowBooting,
  reportProviderStatus,
  requestCancelMachine,
  requestStartMachine,
  requestStopMachine,
  snapshotToMachineRecord,
} from './machine-lifecycle.js';

const NOW = '2026-07-05T10:00:00.000Z';
const NOW_MS = Date.parse(NOW);

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcText = readFileSync(join(__dirname, 'machine-lifecycle.js'), 'utf8');

function ctx(overrides = {}) {
  return {
    subscriptionActive: true,
    providerRunningVerified: true,
    providerDestroyedVerified: true,
    now: NOW,
    ...overrides,
  };
}

function sub(overrides = {}) {
  return { id: 'sub-1', server_status: 'offline', env_name: 'ComfyUI', ...overrides };
}

function machineRow(overrides = {}) {
  return {
    id: 'm-1',
    status: 'creating',
    instance_id: 'inst-1',
    template: 'ComfyUI',
    created_at: NOW,
    ...overrides,
  };
}

function idleRecord(overrides = {}) {
  return snapshotToMachineRecord(sub(), null, 'user-1', overrides);
}

function provisioningRecord(overrides = {}) {
  return snapshotToMachineRecord(sub({ server_status: 'provisioning' }), machineRow(), 'user-1', overrides);
}

function runningRecord(overrides = {}) {
  return snapshotToMachineRecord(
    sub({ server_status: 'online' }),
    machineRow({ status: 'running' }),
    'user-1',
    overrides,
  );
}

describe('SCB 4.0 machine lifecycle purity', () => {
  it('exports version and lifecycle statuses', () => {
    assert.equal(MACHINE_STATE_MACHINE_VERSION, '1.0');
    assert.deepEqual(Object.values(MACHINE_LIFECYCLE_STATUS).sort(), ['error', 'idle', 'provisioning', 'running', 'stopping']);
  });

  it('source has no DB or HTTP imports', () => {
    for (const token of ['supabase', 'fetch(', 'console.', '@supabase']) {
      assert.ok(!srcText.includes(token), \`forbidden token \${token}\`);
    }
  });

  it('transition map covers start, provider, stop, cancel, destroy, drift', () => {
    const keys = getTransitionMap().map((d) => \`\${d.from ?? 'null'}:\${d.command}:\${d.to}\`);
    assert.ok(keys.includes(\`null:\${MACHINE_COMMAND.START_REQUESTED}:\${MACHINE_LIFECYCLE_STATUS.PROVISIONING}\`));
    assert.ok(keys.includes(\`\${MACHINE_LIFECYCLE_STATUS.RUNNING}:\${MACHINE_COMMAND.STOP_REQUESTED}:\${MACHINE_LIFECYCLE_STATUS.STOPPING}\`));
    assert.ok(keys.includes(\`\${MACHINE_LIFECYCLE_STATUS.PROVISIONING}:\${MACHINE_COMMAND.CANCEL_REQUESTED}:\${MACHINE_LIFECYCLE_STATUS.STOPPING}\`));
    assert.ok(keys.includes(\`\${MACHINE_LIFECYCLE_STATUS.PROVISIONING}:\${MACHINE_COMMAND.DRIFT_REPAIR}:\${MACHINE_LIFECYCLE_STATUS.RUNNING}\`));
  });
});

describe('deriveLifecycleStatus', () => {
  it('idle when offline without machine', () => {
    assert.equal(deriveLifecycleStatus(sub(), null), MACHINE_LIFECYCLE_STATUS.IDLE);
  });

  it('provisioning when subscription provisioning with booting machine', () => {
    assert.equal(
      deriveLifecycleStatus(sub({ server_status: 'provisioning' }), machineRow({ status: 'starting' })),
      MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    );
  });

  it('running when subscription online', () => {
    assert.equal(deriveLifecycleStatus(sub({ server_status: 'online' }), machineRow({ status: 'running' })), MACHINE_LIFECYCLE_STATUS.RUNNING);
  });

  it('running when provisioning but machine already running', () => {
    assert.equal(
      deriveLifecycleStatus(sub({ server_status: 'provisioning' }), machineRow({ status: 'running' })),
      MACHINE_LIFECYCLE_STATUS.RUNNING,
    );
  });

  it('stopping when destroy in progress', () => {
    assert.equal(deriveLifecycleStatus(sub({ server_status: 'online' }), machineRow({ status: 'running' }), { destroyInProgress: true }), MACHINE_LIFECYCLE_STATUS.STOPPING);
  });

  it('error when machine row error', () => {
    assert.equal(deriveLifecycleStatus(sub({ server_status: 'provisioning' }), machineRow({ status: 'error' })), MACHINE_LIFECYCLE_STATUS.ERROR);
  });
});

describe('snapshotToMachineRecord and deriveSessionPhase', () => {
  it('returns null without subscription', () => {
    assert.equal(snapshotToMachineRecord(null, null, 'user-1'), null);
  });

  it('maps machine snapshot fields', () => {
    const record = provisioningRecord();
    assert.equal(record.userId, 'user-1');
    assert.equal(record.machine.id, 'm-1');
    assert.equal(record.machine.instanceId, 'inst-1');
  });

  it('derives session phases', () => {
    assert.equal(deriveSessionPhase(idleRecord()), 'idle');
    assert.equal(deriveSessionPhase(provisioningRecord()), 'opening');
    assert.equal(deriveSessionPhase(runningRecord()), 'running');
    assert.equal(deriveSessionPhase(snapshotToMachineRecord(sub({ server_status: 'stopping' }), machineRow(), 'user-1')), 'stopping');
    assert.equal(deriveSessionPhase(runningRecord(), { disconnected: true }), 'disconnected');
  });
});

describe('isMachineRowBooting', () => {
  it('detects creating and starting', () => {
    assert.equal(isMachineRowBooting(machineRow({ status: 'creating' })), true);
    assert.equal(isMachineRowBooting(machineRow({ status: 'starting' })), true);
    assert.equal(isMachineRowBooting(machineRow({ status: 'running' })), false);
    assert.equal(isMachineRowBooting(null), false);
  });
});

describe('requestStartMachine', () => {
  it('creates provisioning record from null', () => {
    const result = requestStartMachine({ userId: 'user-1', subscriptionId: 'sub-1', envName: 'ComfyUI' }, ctx());
    assert.equal(result.state, 'OK');
    assert.equal(result.machine.status, MACHINE_LIFECYCLE_STATUS.PROVISIONING);
    assert.equal(result.event, MACHINE_DOMAIN_EVENT.START_REQUESTED);
  });

  it('rejects when subscription inactive', () => {
    const result = requestStartMachine({ userId: 'user-1', subscriptionId: 'sub-1' }, ctx({ subscriptionActive: false }));
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, MACHINE_ERROR_CODE.SUBSCRIPTION_NOT_ACTIVE);
  });

  it('idempotent when already provisioning', () => {
    const record = provisioningRecord();
    const result = executeCommand(record, MACHINE_COMMAND.START_REQUESTED, ctx(), { userId: 'user-1', subscriptionId: 'sub-1' });
    assert.equal(result.state, 'IGNORED');
  });
});

describe('provider status reporting', () => {
  it('promotes provisioning to running when provider running verified', () => {
    const record = provisioningRecord();
    const result = reportProviderStatus(record, ctx(), { providerPhase: 'running' });
    assert.equal(result.state, 'OK');
    assert.equal(result.machine.status, MACHINE_LIFECYCLE_STATUS.RUNNING);
    assert.equal(result.machine.serverStatus, 'online');
    assert.equal(result.event, MACHINE_DOMAIN_EVENT.MACHINE_RUNNING);
  });

  it('updates boot status while provisioning', () => {
    const record = provisioningRecord();
    const result = reportProviderStatus(record, ctx(), { providerPhase: 'starting' });
    assert.equal(result.state, 'OK');
    assert.equal(result.machine.machine.status, 'starting');
    assert.equal(result.event, MACHINE_DOMAIN_EVENT.MACHINE_BOOTING);
  });

  it('requires provider verify for running promotion', () => {
    const record = provisioningRecord();
    const result = reportProviderStatus(record, ctx({ providerRunningVerified: false }), { providerPhase: 'running' });
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, MACHINE_ERROR_CODE.PROVIDER_NOT_VERIFIED);
  });
});

describe('stop, cancel, destroy', () => {
  it('stop running machine', () => {
    const result = requestStopMachine(runningRecord(), ctx());
    assert.equal(result.state, 'OK');
    assert.equal(result.machine.status, MACHINE_LIFECYCLE_STATUS.STOPPING);
    assert.equal(result.event, MACHINE_DOMAIN_EVENT.MACHINE_STOPPING);
  });

  it('cancel provisioning machine', () => {
    const result = requestCancelMachine(provisioningRecord(), ctx());
    assert.equal(result.state, 'OK');
    assert.equal(result.machine.status, MACHINE_LIFECYCLE_STATUS.STOPPING);
  });

  it('complete destroy from stopping', () => {
    let record = requestStopMachine(runningRecord(), ctx()).machine;
    const result = completeDestroyMachine(record, ctx());
    assert.equal(result.state, 'OK');
    assert.equal(result.machine.status, MACHINE_LIFECYCLE_STATUS.IDLE);
    assert.equal(result.machine.machine, null);
    assert.equal(result.event, MACHINE_DOMAIN_EVENT.MACHINE_DESTROYED);
  });

  it('rejects stop from idle', () => {
    const result = requestStopMachine(idleRecord(), ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, MACHINE_ERROR_CODE.INVALID_TRANSITION);
  });
});

describe('drift repair command', () => {
  it('promote_online from provisioning', () => {
    const result = applyDriftRepair(provisioningRecord(), ctx(), 'promote_online');
    assert.equal(result.state, 'OK');
    assert.equal(result.machine.status, MACHINE_LIFECYCLE_STATUS.RUNNING);
    assert.equal(result.event, MACHINE_DOMAIN_EVENT.DRIFT_REPAIRED);
  });

  it('reset_idle from provisioning', () => {
    const result = applyDriftRepair(provisioningRecord(), ctx(), 'reset_idle');
    assert.equal(result.state, 'OK');
    assert.equal(result.machine.status, MACHINE_LIFECYCLE_STATUS.IDLE);
  });
});

describe('detectDriftRepair', () => {
  it('detects orphan online subscription', () => {
    const drift = detectDriftRepair(sub({ server_status: 'online' }), null, NOW_MS);
    assert.equal(drift?.repairAction, 'reset_idle');
    assert.equal(drift?.reason, 'reset_orphan_online');
  });

  it('detects provisioning machine already running', () => {
    const drift = detectDriftRepair(sub({ server_status: 'provisioning' }), machineRow({ status: 'running' }), NOW_MS);
    assert.equal(drift?.repairAction, 'promote_online');
  });

  it('detects leaked machine while subscription offline', () => {
    const drift = detectDriftRepair(sub({ server_status: 'offline' }), machineRow({ status: 'running' }), NOW_MS);
    assert.equal(drift?.repairAction, 'destroy_machine');
  });

  it('returns null when aligned idle', () => {
    assert.equal(detectDriftRepair(sub(), null, NOW_MS), null);
  });

  it('detects invalid machine row without instance id', () => {
    const drift = detectDriftRepair(sub({ server_status: 'provisioning' }), machineRow({ instance_id: null }), NOW_MS);
    assert.equal(drift?.repairAction, 'mark_destroyed');
  });
});

describe('findTransitions', () => {
  it('returns empty for illegal command', () => {
    assert.equal(findTransitions(MACHINE_LIFECYCLE_STATUS.IDLE, 'NOPE').length, 0);
  });

  it('executeCommand surfaces invalid transition', () => {
    const result = executeCommand(idleRecord(), 'NOPE', ctx());
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, MACHINE_ERROR_CODE.INVALID_TRANSITION);
  });
});
`);

write('src/lib/gpu/machine-session-view.test.mjs', `import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MACHINE_LIFECYCLE_STATUS,
  MACHINE_DOMAIN_EVENT,
  snapshotToMachineRecord,
} from './machine-lifecycle.js';
import { resolveMachineSessionView } from './machine-session-view.js';

function sub(overrides = {}) {
  return { id: 'sub-1', server_status: 'offline', env_name: 'ComfyUI — Art', user_id: 'user-1', ...overrides };
}

function machineRow(overrides = {}) {
  return {
    id: 'm-1',
    status: 'creating',
    instance_id: 'inst-1',
    template: 'ComfyUI — Art',
    created_at: '2026-07-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('resolveMachineSessionView', () => {
  it('idle view when no subscription record', () => {
    const view = resolveMachineSessionView(null, { envName: 'ComfyUI' });
    assert.equal(view.phase, 'idle');
    assert.equal(view.actions.canStart, true);
    assert.equal(view.workspace.name, 'ComfyUI');
  });

  it('builds from MachineRecord', () => {
    const record = snapshotToMachineRecord(sub({ server_status: 'provisioning' }), machineRow(), 'user-1');
    const view = resolveMachineSessionView(record, { envName: 'ComfyUI — Art' });
    assert.equal(view.phase, 'opening');
    assert.equal(view.lifecycleStatus, MACHINE_LIFECYCLE_STATUS.PROVISIONING);
    assert.equal(view.actions.canCancel, true);
    assert.equal(view.actions.canStart, false);
    assert.equal(view.workspace.locked, true);
    assert.equal(view.machine.id, 'm-1');
    assert.equal(view.domainEvent, MACHINE_DOMAIN_EVENT.MACHINE_BOOTING);
  });

  it('builds from subscription + machine rows', () => {
    const view = resolveMachineSessionView(
      sub({ server_status: 'online' }),
      machineRow({ status: 'running' }),
      'user-1',
      { envName: 'ComfyUI — Art', comfyUrl: 'https://comfy.example' },
    );
    assert.equal(view.phase, 'running');
    assert.equal(view.actions.canStop, true);
    assert.equal(view.actions.canOpenComfy, true);
    assert.equal(view.domainEvent, MACHINE_DOMAIN_EVENT.MACHINE_RUNNING);
  });

  it('disconnected phase overrides running lifecycle', () => {
    const record = snapshotToMachineRecord(sub({ server_status: 'online' }), machineRow({ status: 'running' }), 'user-1');
    const view = resolveMachineSessionView(record, { disconnected: true });
    assert.equal(view.phase, 'disconnected');
    assert.equal(view.actions.canStop, true);
    assert.match(view.message, /Mất kết nối/);
  });

  it('error phase exposes retry-friendly stop action', () => {
    const record = snapshotToMachineRecord(sub({ server_status: 'provisioning' }), machineRow({ status: 'error' }), 'user-1');
    const view = resolveMachineSessionView(record, { envName: 'ComfyUI — Art' });
    assert.equal(view.phase, 'error');
    assert.equal(view.domainEvent, MACHINE_DOMAIN_EVENT.MACHINE_ERROR);
    assert.equal(view.actions.canStart, false);
  });

  it('stopping phase locks workspace', () => {
    const record = snapshotToMachineRecord(sub({ server_status: 'stopping' }), machineRow({ status: 'running' }), 'user-1');
    const view = resolveMachineSessionView(record, { envName: 'ComfyUI — Art' });
    assert.equal(view.phase, 'stopping');
    assert.equal(view.workspace.locked, true);
    assert.equal(view.actions.canCancel, false);
  });

  it('canOpenComfy requires comfyUrl and running machine status', () => {
    const record = snapshotToMachineRecord(sub({ server_status: 'online' }), machineRow({ status: 'running' }), 'user-1');
    assert.equal(resolveMachineSessionView(record).actions.canOpenComfy, false);
    assert.equal(resolveMachineSessionView(record, { comfyUrl: 'https://x' }).actions.canOpenComfy, true);
  });

  it('re-exports snapshotToMachineRecord from module', () => {
    const record = snapshotToMachineRecord(sub(), null, 'user-1');
    assert.equal(record.status, MACHINE_LIFECYCLE_STATUS.IDLE);
  });
});
`);

console.log('SCB4 file writer complete');
