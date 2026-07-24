import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatDisplayHours,
  formatRuntimeClock,
  resolveOpeningBootStep,
  resolveTimerDisplayMode,
} from './dashboard-session-display.js';
import { resolveBootDisplayPhase } from './scb-dashboard-machine-view.ts';

describe('dashboard-session-display', () => {
  it('formatRuntimeClock pads hh:mm:ss', () => {
    assert.equal(formatRuntimeClock(5028), '01:23:48');
    assert.equal(formatRuntimeClock(0), '00:00:00');
  });

  it('formatDisplayHours uses human labels', () => {
    assert.equal(formatDisplayHours(8.42), '8.42h');
    assert.equal(formatDisplayHours(20.09), '20.09h');
    assert.equal(formatDisplayHours(110), '110h');
    assert.equal(formatDisplayHours(0.5), '30 phút');
    assert.equal(formatDisplayHours(null), '—');
  });

  it('resolveOpeningBootStep uses server message and comfy hint only', () => {
    assert.equal(resolveOpeningBootStep('opening', 'Đang khởi tạo', false), 'gpu-boot');
    assert.equal(
      resolveOpeningBootStep('opening', 'ComfyUI sẵn sàng', false),
      'comfy-boot',
    );
    assert.equal(resolveOpeningBootStep('opening', null, true), 'comfy-boot');
    assert.equal(resolveOpeningBootStep('running', 'ComfyUI', true), null);
  });

  it('resolveTimerDisplayMode follows billing anchor UX', () => {
    assert.equal(resolveTimerDisplayMode('idle', false), 'hidden');
    assert.equal(resolveTimerDisplayMode('opening', false), 'muted');
    assert.equal(resolveTimerDisplayMode('running', false), 'muted');
    assert.equal(resolveTimerDisplayMode('running', true), 'live');
    assert.equal(resolveTimerDisplayMode('disconnected', true), 'live');
    assert.equal(resolveTimerDisplayMode('error', true), 'live');
    assert.equal(resolveTimerDisplayMode('stopping', true), 'paused');
  });

  it('resolveBootDisplayPhase keeps running when machine row is already up', () => {
    assert.equal(
      resolveBootDisplayPhase('running', false, {
        lifecycleStatus: 'running',
        serverStatus: 'online',
        phase: 'running',
        machine: { id: 'm1', status: 'running', instanceId: 'i1', template: null },
      }),
      'running',
    );
    assert.equal(
      resolveBootDisplayPhase('opening', false, {
        lifecycleStatus: 'provisioning',
        serverStatus: 'provisioning',
        phase: 'opening',
        machine: { id: 'm1', status: 'running', instanceId: 'i1', template: null },
      }),
      'running',
    );
    assert.equal(
      resolveBootDisplayPhase('running', false, {
        lifecycleStatus: 'provisioning',
        serverStatus: 'provisioning',
        phase: 'running',
      }),
      'opening',
    );
    assert.equal(resolveBootDisplayPhase('stopping', false, null), 'stopping');
  });
});
