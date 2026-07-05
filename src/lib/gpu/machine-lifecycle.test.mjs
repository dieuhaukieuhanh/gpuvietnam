import assert from 'node:assert/strict';
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
    ip_address: '1.2.3.4',
    port: 30954,
    ...overrides,
  };
}

function trafficReadyMachine(overrides = {}) {
  return machineRow({
    status: 'running',
    projection_verified_at: new Date().toISOString(),
    projection_message: 'ComfyUI sẵn sàng',
    ...overrides,
  });
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
    trafficReadyMachine(),
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
      assert.ok(!srcText.includes(token), `forbidden token ${token}`);
    }
  });

  it('transition map covers start, provider, stop, cancel, destroy, drift', () => {
    const keys = getTransitionMap().map((d) => `${d.from ?? 'null'}:${d.command}:${d.to}`);
    assert.ok(keys.includes(`null:${MACHINE_COMMAND.START_REQUESTED}:${MACHINE_LIFECYCLE_STATUS.PROVISIONING}`));
    assert.ok(keys.includes(`${MACHINE_LIFECYCLE_STATUS.RUNNING}:${MACHINE_COMMAND.STOP_REQUESTED}:${MACHINE_LIFECYCLE_STATUS.STOPPING}`));
    assert.ok(keys.includes(`${MACHINE_LIFECYCLE_STATUS.PROVISIONING}:${MACHINE_COMMAND.CANCEL_REQUESTED}:${MACHINE_LIFECYCLE_STATUS.STOPPING}`));
    assert.ok(keys.includes(`${MACHINE_LIFECYCLE_STATUS.PROVISIONING}:${MACHINE_COMMAND.DRIFT_REPAIR}:${MACHINE_LIFECYCLE_STATUS.RUNNING}`));
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

  it('running when subscription online and Comfy traffic-ready', () => {
    assert.equal(
      deriveLifecycleStatus(sub({ server_status: 'online' }), trafficReadyMachine()),
      MACHINE_LIFECYCLE_STATUS.RUNNING,
    );
  });

  it('provisioning when machine running but Comfy not traffic-ready', () => {
    assert.equal(
      deriveLifecycleStatus(sub({ server_status: 'online' }), machineRow({ status: 'running' })),
      MACHINE_LIFECYCLE_STATUS.PROVISIONING,
    );
  });

  it('provisioning until subscription online even if machine row running', () => {
    assert.equal(
      deriveLifecycleStatus(sub({ server_status: 'provisioning' }), machineRow({ status: 'running' })),
      MACHINE_LIFECYCLE_STATUS.PROVISIONING,
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
    const drift = detectDriftRepair(
      sub({ server_status: 'provisioning' }),
      machineRow({
        status: 'running',
        ip_address: '1.2.3.4',
        port: 30954,
        projection_verified_at: new Date().toISOString(),
        projection_message: 'ComfyUI sẵn sàng',
      }),
      NOW_MS,
    );
    assert.equal(drift?.repairAction, 'promote_online');
  });

  it('does not promote online while ComfyUI projection not ready', () => {
    const drift = detectDriftRepair(
      sub({ server_status: 'provisioning' }),
      machineRow({ status: 'running', projection_message: 'Đang khởi động ComfyUI...' }),
      NOW_MS,
    );
    assert.equal(drift, null);
  });

  it('detects leaked machine while subscription offline', () => {
    const drift = detectDriftRepair(sub({ server_status: 'offline' }), machineRow({ status: 'running' }), NOW_MS);
    assert.equal(drift?.repairAction, 'destroy_machine');
  });

  it('repairs booting subscription drift instead of destroying recent boot machine', () => {
    const drift = detectDriftRepair(
      sub({ server_status: 'offline' }),
      machineRow({ status: 'creating', created_at: new Date(NOW_MS).toISOString() }),
      NOW_MS,
    );
    assert.equal(drift?.repairAction, 'promote_provisioning');
    assert.equal(drift?.reason, 'repaired_booting_subscription');
  });

  it('returns null when aligned idle', () => {
    assert.equal(detectDriftRepair(sub(), null, NOW_MS), null);
  });

  it('returns null when provisioning without machine (boot in flight)', () => {
    assert.equal(detectDriftRepair(sub({ server_status: 'provisioning' }), null, NOW_MS), null);
  });

  it('returns null for recent booting machine without instance id', () => {
    const drift = detectDriftRepair(
      sub({ server_status: 'provisioning' }),
      machineRow({ instance_id: null, status: 'creating', created_at: new Date(NOW_MS).toISOString() }),
      NOW_MS,
    );
    assert.equal(drift, null);
  });

  it('detects invalid machine row without instance id when stale', () => {
    const drift = detectDriftRepair(
      sub({ server_status: 'provisioning' }),
      machineRow({ instance_id: null, status: 'creating', created_at: new Date(NOW_MS - 20 * 60 * 1000).toISOString() }),
      NOW_MS,
    );
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
