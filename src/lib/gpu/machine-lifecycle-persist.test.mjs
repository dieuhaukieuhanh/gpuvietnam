import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { runMachineTransition } from './machine-lifecycle-persist.js';
import { MACHINE_COMMAND, snapshotToMachineRecord } from './machine-lifecycle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcText = readFileSync(join(__dirname, 'machine-lifecycle-persist.js'), 'utf8');

describe('machine-lifecycle-persist', () => {
  it('does not import HTTP or drift repair executors', () => {
    for (const token of ['fetch(', 'getGpuService', 'executeSubscriptionMachineDriftRepair']) {
      assert.ok(!srcText.includes(token), 'must not reference ' + token);
    }
  });

  it('runMachineTransition delegates to executeCommand', () => {
    const record = snapshotToMachineRecord({ id: 'sub-1', server_status: 'offline' }, null, 'user-1');
    const result = runMachineTransition(record, MACHINE_COMMAND.START_REQUESTED, {
      subscriptionActive: true,
    }, { userId: 'user-1', subscriptionId: 'sub-1' });
    assert.equal(result.state, 'OK');
    assert.equal(result.machine?.serverStatus, 'provisioning');
  });

  it('exports persist helpers for command APIs', () => {
    assert.match(srcText, /persistStartRequested/);
    assert.match(srcText, /persistDestroyCompleted/);
    assert.match(srcText, /persistProviderRunning/);
    assert.match(srcText, /persistDriftRepair/);
    assert.match(srcText, /claimSubscriptionForProvision/);
  });
});
