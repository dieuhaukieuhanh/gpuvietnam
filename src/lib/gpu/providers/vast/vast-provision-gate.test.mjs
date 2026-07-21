import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyVastGateFailReason,
  parseNvidiaSmiGate,
} from './vast-provision-gate.js';

describe('parseNvidiaSmiGate', () => {
  it('accepts matching 3090 line', () => {
    const r = parseNvidiaSmiGate('NVIDIA GeForce RTX 3090, 24576 MiB', 'rtx3090');
    assert.equal(r.ok, true);
  });

  it('rejects name mismatch', () => {
    const r = parseNvidiaSmiGate('NVIDIA GeForce RTX 4090, 24576 MiB', 'rtx3090');
    assert.equal(r.ok, false);
    assert.match(String(r.detail), /mismatch/i);
  });

  it('rejects empty', () => {
    assert.equal(parseNvidiaSmiGate('', 'rtx4090_1x').ok, false);
  });
});

describe('classifyVastGateFailReason', () => {
  it('maps steps', () => {
    assert.equal(classifyVastGateFailReason('ssh_exec timeout'), 'ssh_exec');
    assert.equal(classifyVastGateFailReason('port: no mapped ports'), 'port');
    assert.equal(classifyVastGateFailReason('http_endpoint timeout'), 'http_endpoint');
    assert.equal(classifyVastGateFailReason('gpu_stats: mismatch'), 'gpu_stats');
    assert.equal(classifyVastGateFailReason('comfy_smoke: prompt fail'), 'comfy_smoke');
    assert.equal(classifyVastGateFailReason('nvidia_smi: GPU name mismatch'), 'nvidia_smi');
    assert.equal(classifyVastGateFailReason('cuda: smoke failed'), 'cuda');
    assert.equal(classifyVastGateFailReason('comfy_workflow timeout'), 'comfy_workflow');
  });
});
