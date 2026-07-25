import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildGateOpsFlags,
  classifyProvisionGateFailReason,
  HTTP_CUSTOMER_PATH_FAIL_FAST,
  isBadGatewayResponse,
  isProxyNotFoundHtml,
  normalizeComfyBaseUrl,
  parseSystemStatsGpuGate,
  waitForHttpCustomerPath,
} from './provision-http-gate.js';

describe('normalizeComfyBaseUrl', () => {
  it('normalizes host:port', () => {
    assert.equal(normalizeComfyBaseUrl('1.2.3.4:8188'), 'http://1.2.3.4:8188');
  });

  it('strips trailing slash', () => {
    assert.equal(normalizeComfyBaseUrl('https://abc.clore.app/'), 'https://abc.clore.app');
  });

  it('rejects empty', () => {
    assert.equal(normalizeComfyBaseUrl(''), null);
  });
});

describe('parseSystemStatsGpuGate', () => {
  it('accepts matching 3090 device', () => {
    const r = parseSystemStatsGpuGate(
      { devices: [{ name: 'NVIDIA GeForce RTX 3090', vram_total: 24 }] },
      'rtx3090',
    );
    assert.equal(r.ok, true);
  });

  it('rejects GPU mismatch', () => {
    const r = parseSystemStatsGpuGate(
      { devices: [{ name: 'NVIDIA GeForce RTX 4090', vram_total: 24 }] },
      'rtx3090',
    );
    assert.equal(r.ok, false);
    assert.match(String(r.detail), /mismatch/i);
  });

  it('rejects empty devices', () => {
    assert.equal(parseSystemStatsGpuGate({ devices: [] }, 'rtx3090').ok, false);
  });
});

describe('classifyProvisionGateFailReason', () => {
  it('maps HTTP-first steps', () => {
    assert.equal(classifyProvisionGateFailReason('http_endpoint timeout'), 'http_endpoint');
    assert.equal(classifyProvisionGateFailReason('gpu_stats: mismatch'), 'gpu_stats');
    assert.equal(classifyProvisionGateFailReason('comfy_smoke: prompt fail'), 'comfy_smoke');
    assert.equal(classifyProvisionGateFailReason('ssh_exec timeout'), 'ssh_exec');
  });
});

describe('buildGateOpsFlags', () => {
  it('marks degraded when ssh fails', () => {
    const flags = buildGateOpsFlags({ sshOk: false, sshDetail: 'ECONNRESET' });
    assert.equal(flags.ssh_ok, false);
    assert.equal(flags.ops_degraded, true);
    assert.match(String(flags.ssh_detail), /ECONNRESET/);
  });

  it('clears degraded when ssh ok', () => {
    const flags = buildGateOpsFlags({ sshOk: true });
    assert.equal(flags.ssh_ok, true);
    assert.equal(flags.ops_degraded, false);
  });
});

describe('isProxyNotFoundHtml', () => {
  it('detects Clore edge placeholder', () => {
    assert.equal(
      isProxyNotFoundHtml('<title>Proxy Not Found</title><body>Proxy Not Found</body>'),
      true,
    );
    assert.equal(isProxyNotFoundHtml('{"devices":[]}'), false);
  });
});

describe('isBadGatewayResponse', () => {
  it('detects status 502 and Bad Gateway HTML', () => {
    assert.equal(isBadGatewayResponse(502, ''), true);
    assert.equal(
      isBadGatewayResponse(200, '<title>clorecloud.net | 502: Bad gateway</title>'),
      true,
    );
    assert.equal(isBadGatewayResponse(404, 'not found'), false);
  });
});

describe('HTTP_CUSTOMER_PATH_FAIL_FAST defaults', () => {
  it('uses 45s Proxy Not Found and 90s 502 budgets', () => {
    assert.equal(HTTP_CUSTOMER_PATH_FAIL_FAST.proxyNotFoundFailMs, 45_000);
    assert.equal(HTTP_CUSTOMER_PATH_FAIL_FAST.badGatewayFailMs, 90_000);
  });
});

describe('waitForHttpCustomerPath fail-fast', () => {
  it('fails Proxy Not Found before full timeout', async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('<title>Proxy Not Found</title><body>Proxy Not Found</body>', {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      });
    try {
      const started = Date.now();
      const result = await waitForHttpCustomerPath('https://dead.example', {
        gpuLine: 'rtx3090',
        timeoutMs: 60_000,
        pollMs: 20,
        proxyNotFoundFailMs: 80,
        badGatewayFailMs: 60_000,
      });
      const elapsed = Date.now() - started;
      assert.equal(result.ok, false);
      assert.equal(result.step, 'http_endpoint');
      assert.match(result.detail, /Proxy Not Found for/i);
      assert.ok(elapsed < 5_000, `expected fail-fast, elapsed=${elapsed}`);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it('fails sustained 502 before full timeout', async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('<title>clorecloud.net | 502: Bad gateway</title>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      });
    try {
      const started = Date.now();
      const result = await waitForHttpCustomerPath('https://boot.example', {
        gpuLine: 'rtx3090',
        timeoutMs: 60_000,
        pollMs: 20,
        proxyNotFoundFailMs: 60_000,
        badGatewayFailMs: 80,
      });
      const elapsed = Date.now() - started;
      assert.equal(result.ok, false);
      assert.equal(result.step, 'http_endpoint');
      assert.match(result.detail, /502 for/i);
      assert.ok(elapsed < 5_000, `expected fail-fast, elapsed=${elapsed}`);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
