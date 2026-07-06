import assert from 'node:assert/strict';
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
      trafficReadyMachine(),
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

  it('canOpenComfy when running (comfyUrl comes from infra poll on client)', () => {
    const record = snapshotToMachineRecord(sub({ server_status: 'online' }), trafficReadyMachine(), 'user-1');
    assert.equal(resolveMachineSessionView(record).actions.canOpenComfy, true);
    const opening = snapshotToMachineRecord(sub({ server_status: 'online' }), machineRow({ status: 'running' }), 'user-1');
    assert.equal(resolveMachineSessionView(opening).actions.canOpenComfy, false);
  });

  it('canStop when billing started even during opening phase', () => {
    const openingBillable = snapshotToMachineRecord(
      sub({ server_status: 'online' }),
      machineRow({ status: 'running' }),
      'user-1',
    );
    assert.equal(resolveMachineSessionView(openingBillable).actions.canStop, false);
    assert.equal(
      resolveMachineSessionView(openingBillable, { billingStarted: true }).actions.canStop,
      true,
    );
  });

  it('re-exports snapshotToMachineRecord from module', () => {
    const record = snapshotToMachineRecord(sub(), null, 'user-1');
    assert.equal(record.status, MACHINE_LIFECYCLE_STATUS.IDLE);
  });
});
