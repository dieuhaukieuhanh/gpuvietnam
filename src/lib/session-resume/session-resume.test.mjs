import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideSessionResume } from './session-resume-core.js';
import { RESUME_STATE } from './session-resume-states.js';

describe('decideSessionResume', () => {
  it('returns OFFLINE when idle', () => {
    const d = decideSessionResume({ serverStatus: 'offline' });
    assert.equal(d.currentState, RESUME_STATE.OFFLINE);
    assert.equal(d.shouldResume, false);
    assert.equal(d.allowNewProvision, true);
    assert.equal(d.duplicateStartPrevented, false);
  });

  it('resumes RUNNING machine without allowing new provision', () => {
    const d = decideSessionResume({
      serverStatus: 'online',
      machine: { id: 'm1', status: 'running', instance_id: 'i1' },
      liveStatus: 'running',
      healthOk: true,
    });
    assert.equal(d.currentState, RESUME_STATE.RUNNING);
    assert.equal(d.shouldResume, true);
    assert.equal(d.allowNewProvision, false);
    assert.equal(d.duplicateStartPrevented, true);
  });

  it('resumes active provisioning lease', () => {
    const d = decideSessionResume({
      serverStatus: 'provisioning',
      hasActiveLease: true,
      leaseExpired: false,
    });
    assert.equal(d.currentState, RESUME_STATE.PROVISIONING);
    assert.equal(d.shouldResume, true);
    assert.equal(d.allowNewProvision, false);
  });

  it('allows reclaim when lease expired and no machine', () => {
    const d = decideSessionResume({
      serverStatus: 'provisioning',
      hasActiveLease: false,
      leaseExpired: true,
      machine: null,
    });
    assert.equal(d.currentState, RESUME_STATE.OFFLINE);
    assert.equal(d.allowNewProvision, true);
  });

  it('maps booting machine under provisioning', () => {
    const d = decideSessionResume({
      serverStatus: 'provisioning',
      hasActiveLease: true,
      leaseExpired: false,
      machine: { id: 'm1', status: 'creating' },
      liveStatus: 'creating',
    });
    assert.equal(d.currentState, RESUME_STATE.BOOTING);
    assert.equal(d.shouldResume, true);
  });

  it('maps starting comfy when online but not healthy', () => {
    const d = decideSessionResume({
      serverStatus: 'online',
      machine: { id: 'm1', status: 'running' },
      liveStatus: 'starting',
      healthOk: false,
    });
    assert.equal(d.currentState, RESUME_STATE.STARTING_COMFY);
    assert.equal(d.shouldResume, true);
    assert.equal(d.allowNewProvision, false);
  });

  it('resumes pending gpu session', () => {
    const d = decideSessionResume({
      serverStatus: 'offline',
      sessionStatus: 'pending',
    });
    assert.equal(d.currentState, RESUME_STATE.PROVISIONING);
    assert.equal(d.shouldResume, true);
  });

  it('maps STOPPING and ERROR', () => {
    assert.equal(
      decideSessionResume({ machineLifecycleStatus: 'stopping' }).currentState,
      RESUME_STATE.STOPPING,
    );
    const err = decideSessionResume({ liveStatus: 'error', machine: { id: '1' } });
    assert.equal(err.currentState, RESUME_STATE.ERROR);
    assert.equal(err.shouldResume, true);
    assert.equal(err.allowNewProvision, true);
    assert.equal(err.duplicateStartPrevented, false);
  });
});
