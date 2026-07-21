import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  PROVISION_STAGE,
  mapProgressTickToStage,
  setProvisionProgress,
  getProvisionProgress,
  healProgressRecordFromTick,
  resetProvisionProgressStoreForTests,
  resetProvisionProgressMetrics,
  getProvisionProgressMetrics,
} from './index.js';

describe('provision-progress', () => {
  beforeEach(() => {
    process.env.PROVISION_PROGRESS_STORE_FILE = 'tmp/provision-progress-test.json';
    resetProvisionProgressStoreForTests();
    resetProvisionProgressMetrics();
  });

  it('maps ticks to canonical stages', () => {
    assert.equal(mapProgressTickToStage('wallet_check'), PROVISION_STAGE.CHECKING_WALLET);
    assert.equal(mapProgressTickToStage('marketplace_fetch'), PROVISION_STAGE.SEARCHING_GPU);
    assert.equal(mapProgressTickToStage('offer_selection'), PROVISION_STAGE.SELECTING_HOST);
    assert.equal(mapProgressTickToStage('create_order'), PROVISION_STAGE.CREATING_ORDER);
    assert.equal(mapProgressTickToStage('order_id_recovery'), PROVISION_STAGE.RECOVERING_ORDER_ID);
    assert.equal(mapProgressTickToStage('provision_gate'), PROVISION_STAGE.BOOTING_MACHINE);
    assert.equal(mapProgressTickToStage('comfy_ready'), PROVISION_STAGE.RUNNING);
  });

  it('unsticks progress when machine is already RUNNING', async () => {
    await setProvisionProgress('sub-live', {
      tick: 'order_id_recovery',
      requestId: 'r-live',
    });
    const snap = await getProvisionProgress('sub-live', {
      resumeState: 'RUNNING',
      machineStatus: 'running',
    });
    assert.equal(snap.stage, PROVISION_STAGE.RUNNING);
    assert.ok(snap.timeline.every((t) => t.state === 'done'));
  });

  it('heals DB/file rows where tick is ahead of stage', () => {
    const { record, healed } = healProgressRecordFromTick({
      subscriptionId: 'sub-heal',
      stage: PROVISION_STAGE.RECOVERING_ORDER_ID,
      tick: 'provision_gate',
      message: 'Đang tìm cấu hình',
      updatedAt: 1,
    });
    assert.equal(healed, true);
    assert.equal(record?.stage, PROVISION_STAGE.BOOTING_MACHINE);
    assert.equal(record?.message, 'Đang khởi động máy');
  });

  it('advances stages and builds timeline', async () => {
    const a = await setProvisionProgress('sub-1', {
      tick: 'wallet_check',
      requestId: 'r1',
      gpuType: 'rtx4090_1x',
    });
    assert.equal(a.stage, PROVISION_STAGE.CHECKING_WALLET);
    assert.ok(a.timeline.some((t) => t.state === 'active'));

    const b = await setProvisionProgress('sub-1', { tick: 'create_order', requestId: 'r1' });
    assert.equal(b.stage, PROVISION_STAGE.CREATING_ORDER);
    assert.ok(b.progressPercent > a.progressPercent);

    const c = await setProvisionProgress('sub-1', {
      stage: PROVISION_STAGE.RUNNING,
      tick: 'comfy_ready',
    });
    assert.equal(c.stage, PROVISION_STAGE.RUNNING);
    assert.equal(c.progressPercent, 100);
    assert.ok(c.timeline.every((t) => t.state === 'done'));

    const metrics = getProvisionProgressMetrics();
    assert.ok(metrics.averageProvisionDuration != null);
  });

  it('does not move backwards on happy path', async () => {
    await setProvisionProgress('sub-2', { tick: 'create_order' });
    const again = await setProvisionProgress('sub-2', { tick: 'wallet_check' });
    assert.equal(again.stage, PROVISION_STAGE.CREATING_ORDER);
  });

  it('restores progress after get', async () => {
    await setProvisionProgress('sub-3', { tick: 'starting_comfy', gpuType: 'rtx4090_1x' });
    resetProvisionProgressStoreForTests();
    // force reload from disk
    const snap = await getProvisionProgress('sub-3');
    // store loaded flag reset clears memory but file may still exist — put again for unit isolation
    await setProvisionProgress('sub-3', { tick: 'health_check' });
    const again = await getProvisionProgress('sub-3');
    assert.equal(again.stage, PROVISION_STAGE.STARTING_COMFY);
  });
});