/**
 * SCB 2.1 AF v2 — projection read path unit tests.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getReadPathProfilerLabel,
  isProjectionVerificationStale,
  isScbReadProjectionFirst,
  resolveProjectionMachineStatus,
} from './scb-read-path.js';
import { MACHINE_OPERATION } from './infrastructure/machine-operation-core.js';
import { priorityForOperation } from './infrastructure/machine-operation-policies.js';

describe('scb-read-path (AF v2)', () => {
  it('isScbReadProjectionFirst defaults ON when unset or 1; OFF only when 0', () => {
    const prev = process.env.SCB_READ_PROJECTION_FIRST;
    delete process.env.SCB_READ_PROJECTION_FIRST;
    assert.equal(isScbReadProjectionFirst(), true);
    assert.equal(getReadPathProfilerLabel(), 'Projection');
    process.env.SCB_READ_PROJECTION_FIRST = '1';
    assert.equal(isScbReadProjectionFirst(), true);
    process.env.SCB_READ_PROJECTION_FIRST = '0';
    assert.equal(isScbReadProjectionFirst(), false);
    assert.equal(getReadPathProfilerLabel(), 'Legacy');
    if (prev === undefined) delete process.env.SCB_READ_PROJECTION_FIRST;
    else process.env.SCB_READ_PROJECTION_FIRST = prev;
  });

  it('resolveProjectionMachineStatus propagates Resolved host port without health (comfyUrl null)', () => {
    const status = resolveProjectionMachineStatus(
      {
        id: 'm-1',
        instance_id: 'inst-1',
        status: 'starting',
        ip_address: '1.2.3.4',
        port: 30954,
        created_at: new Date().toISOString(),
        projection_verified_at: new Date().toISOString(),
      },
      { server_status: 'provisioning' },
    );
    assert.equal(status.status, 'starting');
    assert.equal(status.ip, '1.2.3.4');
    assert.equal(status.port, 30954);
    assert.equal(status.comfyUrl, null);
    assert.equal(status.healthOk, false);
  });

  it('resolveProjectionMachineStatus maps running machine from DB when verified with HostPort', () => {
    const status = resolveProjectionMachineStatus(
      {
        id: 'm-1',
        instance_id: 'inst-1',
        status: 'running',
        ip_address: '1.2.3.4',
        port: 30954,
        projection_verified_at: new Date().toISOString(),
        projection_message: 'ComfyUI sẵn sàng',
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      { server_status: 'online' },
    );
    assert.equal(status.status, 'running');
    assert.equal(status.ip, '1.2.3.4');
    assert.equal(status.port, 30954);
    assert.equal(status.comfyUrl, 'http://1.2.3.4:30954');
    assert.equal(status.healthOk, true);
  });

  it('resolveProjectionMachineStatus keeps starting when verified but ComfyUI not ready message', () => {
    const status = resolveProjectionMachineStatus(
      {
        id: 'm-1',
        instance_id: 'inst-1',
        status: 'running',
        ip_address: '1.2.3.4',
        port: 30954,
        projection_verified_at: new Date().toISOString(),
        projection_message: 'Đang khởi động ComfyUI...',
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      { server_status: 'online' },
    );
    assert.equal(status.status, 'starting');
    assert.equal(status.healthOk, false);
    assert.equal(status.comfyUrl, null);
  });

  it('resolveProjectionMachineStatus propagates Pending when ip set but port null', () => {
    const status = resolveProjectionMachineStatus(
      {
        id: 'm-1',
        instance_id: 'inst-1',
        status: 'starting',
        ip_address: '1.2.3.4',
        port: null,
        created_at: new Date().toISOString(),
        projection_verified_at: new Date().toISOString(),
      },
      { server_status: 'provisioning' },
    );
    assert.equal(status.status, 'starting');
    assert.equal(status.ip, '1.2.3.4');
    assert.equal(status.port, null);
    assert.equal(status.comfyUrl, null);
  });

  it('resolveProjectionMachineStatus does not treat legacy port=8080 as Resolved', () => {
    const status = resolveProjectionMachineStatus(
      {
        id: 'm-1',
        instance_id: 'inst-1',
        status: 'running',
        ip_address: '1.2.3.4',
        port: 8080,
        projection_verified_at: new Date().toISOString(),
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      { server_status: 'online' },
    );
    assert.equal(status.status, 'starting');
    assert.equal(status.ip, '1.2.3.4');
    assert.equal(status.port, null);
    assert.equal(status.comfyUrl, null);
  });

  it('resolveProjectionMachineStatus returns offline when subscription offline (leaked machine row)', () => {
    const status = resolveProjectionMachineStatus(
      {
        id: 'm-1',
        instance_id: 'inst-1',
        status: 'running',
        ip_address: '1.2.3.4',
        port: 30954,
        projection_verified_at: new Date().toISOString(),
      },
      { server_status: 'offline' },
    );
    assert.equal(status.status, 'offline');
    assert.equal(status.message, 'Máy chưa bật');
    assert.equal(status.instanceId, null);
  });

  it('resolveProjectionMachineStatus maps running machine while subscription still provisioning', () => {
    const status = resolveProjectionMachineStatus(
      {
        id: 'm-1',
        instance_id: 'inst-1',
        status: 'running',
        ip_address: '1.2.3.4',
        port: 30954,
        projection_verified_at: new Date().toISOString(),
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      { server_status: 'provisioning' },
    );
    assert.equal(status.status, 'starting');
    assert.equal(status.message, 'Đang khởi động ComfyUI...');
    assert.equal(status.comfyUrl, null);
    assert.equal(status.healthOk, false);
  });

  it('resolveProjectionMachineStatus maps verified running when subscription online', () => {
    const status = resolveProjectionMachineStatus(
      {
        id: 'm-1',
        instance_id: 'inst-1',
        status: 'running',
        ip_address: '1.2.3.4',
        port: 30954,
        projection_verified_at: new Date().toISOString(),
        projection_message: 'ComfyUI sẵn sàng',
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      { server_status: 'online' },
    );
    assert.equal(status.status, 'running');
    assert.equal(status.comfyUrl, 'http://1.2.3.4:30954');
    assert.equal(status.healthOk, true);
  });

  it('resolveProjectionMachineStatus keeps provisioning boot after 20 minutes', () => {
    const status = resolveProjectionMachineStatus(
      {
        id: 'm-1',
        instance_id: 'inst-1',
        status: 'starting',
        ip_address: '1.2.3.4',
        port: null,
        created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      },
      { server_status: 'provisioning' },
    );
    assert.equal(status.status, 'starting');
  });

  it('resolveProjectionMachineStatus keeps provisioning boot after 8 minutes', () => {
    const status = resolveProjectionMachineStatus(
      {
        id: 'm-1',
        instance_id: 'inst-1',
        status: 'starting',
        ip_address: '1.2.3.4',
        port: null,
        created_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      },
      { server_status: 'provisioning' },
    );
    assert.equal(status.status, 'starting');
  });

  it('resolveProjectionMachineStatus allows recent provisioning boot', () => {
    const status = resolveProjectionMachineStatus(
      {
        id: 'm-1',
        instance_id: 'inst-1',
        status: 'starting',
        ip_address: '1.2.3.4',
        port: null,
        created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      },
      { server_status: 'provisioning' },
    );
    assert.equal(status.status, 'starting');
  });

  it('resolveProjectionMachineStatus treats stale unverified running as starting (F5 resync)', () => {
    const status = resolveProjectionMachineStatus(
      {
        id: 'm-1',
        instance_id: 'inst-1',
        status: 'running',
        ip_address: '1.2.3.4',
        port: 8080,
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      { server_status: 'online' },
    );
    assert.equal(status.status, 'starting');
    assert.equal(status.message, 'Đang khởi động ComfyUI...');
    assert.equal(status.instanceId, 'inst-1');
    assert.equal(status.healthOk, false);
  });

  it('resolveProjectionMachineStatus returns offline without machine', () => {
    const status = resolveProjectionMachineStatus(null, null);
    assert.equal(status.status, 'offline');
  });

  it('resolveProjectionMachineStatus maps destroyed machine to offline', () => {
    const status = resolveProjectionMachineStatus(
      { id: 'm-1', instance_id: 'inst-1', status: 'destroyed' },
      { server_status: 'offline' },
    );
    assert.equal(status.status, 'offline');
    assert.equal(status.message, 'Máy chưa bật');
  });

  it('resolveProjectionMachineStatus maps error to offline when subscription offline', () => {
    const status = resolveProjectionMachineStatus(
      {
        id: 'm-1',
        instance_id: 'inst-1',
        status: 'error',
        error_message: 'Instance gone',
      },
      { server_status: 'offline' },
    );
    assert.equal(status.status, 'offline');
    assert.equal(status.message, 'Máy chưa bật');
  });

  it('isProjectionVerificationStale treats missing timestamp as stale', () => {
    assert.equal(isProjectionVerificationStale({}, 30_000), true);
    assert.equal(
      isProjectionVerificationStale(
        { projection_verified_at: new Date().toISOString() },
        60_000,
      ),
      false,
    );
  });
});

describe('projection_verify queue operation', () => {
  it('registers priority class PROBE', () => {
    assert.equal(MACHINE_OPERATION.PROJECTION_VERIFY, 'projection_verify');
    assert.equal(priorityForOperation(MACHINE_OPERATION.PROJECTION_VERIFY), 60);
  });
});
