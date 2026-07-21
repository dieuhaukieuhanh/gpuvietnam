import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSessionRestoreViewModel } from './session-restore.js';
import { buildRuntimeRebindPlan } from './runtime-rebind.js';
import { toWorkflowClientSyncPayload } from './workflow-sot.js';

describe('cp-runtime B2 session continuity', () => {
  it('B2.1 workflow sync payload is GPU-independent', () => {
    const payload = toWorkflowClientSyncPayload({
      id: 'wf1',
      project_id: 'p1',
      name: 'Demo',
      document: { '1': { class_type: 'EmptyImage' } },
      settings: { theme: 'dark' },
      revision: 3,
      status: 'draft',
      updated_at: '2026-07-21T00:00:00Z',
    });
    assert.equal(payload.id, 'wf1');
    assert.equal(payload.revision, 3);
    assert.equal(payload.document['1'].class_type, 'EmptyImage');
  });

  it('B2.2 Session Restore ≠ Job Resume', () => {
    const vm = buildSessionRestoreViewModel({
      project: { id: 'p1', name: 'Proj' },
      workflow: { id: 'w1', name: 'WF', revision: 2 },
      job: { id: 'j1', status: 'running', attemptNumber: 2, uiStatus: 'retry' },
    });
    assert.equal(vm.restoreKind, 'session');
    assert.equal(vm.jobResumed, false);
    assert.equal(vm.projectContinues, true);
    assert.equal(vm.jobRerunning, true);
    assert.match(vm.message, /chạy lại/i);
    assert.match(vm.message, /không resume CUDA/i);
  });

  it('B2.2 continues project without active job', () => {
    const vm = buildSessionRestoreViewModel({
      project: { id: 'p1', name: 'Proj' },
      workflow: { id: 'w1', name: 'WF', revision: 1 },
    });
    assert.equal(vm.jobRerunning, false);
    assert.equal(vm.projectContinues, true);
    assert.match(vm.message, /tiếp tục soạn/i);
  });

  it('B2.3 rebind plan detects upstream change', () => {
    const changed = buildRuntimeRebindPlan({
      previousUpstreamUrl: 'http://1.2.3.4:8080',
      nextUpstreamUrl: 'http://5.6.7.8:8080/',
      machineId: 'm1',
      runtimeId: 'r1',
    });
    assert.equal(changed.ok, true);
    assert.equal(changed.changed, true);
    assert.equal(changed.nextUpstreamUrl, 'http://5.6.7.8:8080');

    const same = buildRuntimeRebindPlan({
      previousUpstreamUrl: 'http://1.2.3.4:8080',
      nextUpstreamUrl: 'http://1.2.3.4:8080',
    });
    assert.equal(same.changed, false);

    const bad = buildRuntimeRebindPlan({ nextUpstreamUrl: 'not-a-url' });
    assert.equal(bad.ok, false);
  });
});
