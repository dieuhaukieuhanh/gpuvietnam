import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTestGateFailReason } from './test-gate.js';

describe('classifyTestGateFailReason', () => {
  it('detects disk_only / NO_GPU', () => {
    assert.equal(
      classifyTestGateFailReason('disk_only_billing (GPU struck through / stopped)'),
      'disk_only',
    );
    assert.equal(
      classifyTestGateFailReason('disk_only_billing (NO_GPU from test image /health)'),
      'disk_only',
    );
    assert.equal(
      classifyTestGateFailReason('disk_only_billing (VRAM 0 — GPU detached / storage-only)'),
      'disk_only',
    );
  });

  it('detects gpu / health / endpoint classes', () => {
    assert.equal(
      classifyTestGateFailReason('GPU name mismatch (want 4090, got 3090)'),
      'gpu_detect',
    );
    assert.equal(classifyTestGateFailReason('health timeout'), 'health_http');
    assert.equal(classifyTestGateFailReason('waiting endpoint'), 'endpoint');
  });
});
