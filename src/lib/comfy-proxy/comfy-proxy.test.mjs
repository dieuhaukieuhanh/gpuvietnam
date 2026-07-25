import assert from 'node:assert/strict';
import { describe, it, after } from 'node:test';

import {
  isComfyProxyEnabled,
  resolveComfyProxyBaseUrl,
  buildComfyWorkEnterUrl,
  COMFY_ACCESS_TOKEN_PREFIX,
} from './comfy-proxy-config.js';
import {
  normalizeUpstreamComfyUrl,
  hashComfyAccessToken,
} from './comfy-access-token.js';
import { redactComfyUpstreamForClient } from './comfy-proxy-client-redact.js';
import {
  isIpv4Hostname,
  rewriteIpLiteralUpstreamForFetch,
} from './comfy-ip-hop.js';

describe('comfy-proxy config', () => {
  after(() => {
    delete process.env.COMFY_PROXY_ENABLED;
    delete process.env.COMFY_PROXY_BASE_URL;
  });

  it('isComfyProxyEnabled defaults off', () => {
    delete process.env.COMFY_PROXY_ENABLED;
    assert.equal(isComfyProxyEnabled(), false);
  });

  it('isComfyProxyEnabled accepts 1/true', () => {
    process.env.COMFY_PROXY_ENABLED = '1';
    assert.equal(isComfyProxyEnabled(), true);
    process.env.COMFY_PROXY_ENABLED = 'true';
    assert.equal(isComfyProxyEnabled(), true);
  });

  it('buildComfyWorkEnterUrl uses brand base', () => {
    process.env.COMFY_PROXY_BASE_URL = 'https://work.gpuvietnam.com/';
    assert.equal(
      buildComfyWorkEnterUrl('gvc.abc'),
      'https://work.gpuvietnam.com/enter/gvc.abc',
    );
  });

  it('resolveComfyProxyBaseUrl strips slash', () => {
    process.env.COMFY_PROXY_BASE_URL = 'https://work.example.com/';
    assert.equal(resolveComfyProxyBaseUrl(), 'https://work.example.com');
  });
});

describe('rewriteIpLiteralUpstreamForFetch', () => {
  it('rewrites Vast IPv4:port to sslip hop; leaves Clore hostname', () => {
    assert.equal(
      rewriteIpLiteralUpstreamForFetch('http://173.239.95.142:45522', {
        hopSuffix: 'sslip.io',
      }),
      'http://173-239-95-142.sslip.io:45522',
    );
    assert.equal(
      rewriteIpLiteralUpstreamForFetch('https://abc.us.clorecloud.net', {
        hopSuffix: 'sslip.io',
      }),
      'https://abc.us.clorecloud.net',
    );
    assert.equal(isIpv4Hostname('173.239.95.142'), true);
    assert.equal(isIpv4Hostname('abc.us.clorecloud.net'), false);
  });

  it('can disable hop', () => {
    assert.equal(
      rewriteIpLiteralUpstreamForFetch('http://1.2.3.4:8081', { hopSuffix: null }),
      'http://1.2.3.4:8081',
    );
  });
});

describe('normalizeUpstreamComfyUrl', () => {
  it('accepts https clore host', () => {
    assert.equal(
      normalizeUpstreamComfyUrl('https://abc.us.clorecloud.net/'),
      'https://abc.us.clorecloud.net',
    );
  });

  it('rejects non-http', () => {
    assert.equal(normalizeUpstreamComfyUrl('ftp://x'), null);
    assert.equal(normalizeUpstreamComfyUrl(''), null);
  });

  it('A1 editor mode: empty upstream normalizes to null', () => {
    assert.equal(normalizeUpstreamComfyUrl(null), null);
    assert.equal(normalizeUpstreamComfyUrl(undefined), null);
    assert.equal(normalizeUpstreamComfyUrl('   '), null);
  });
});

describe('hashComfyAccessToken', () => {
  it('is stable sha256 hex', () => {
    const a = hashComfyAccessToken(`${COMFY_ACCESS_TOKEN_PREFIX}x`);
    const b = hashComfyAccessToken(`${COMFY_ACCESS_TOKEN_PREFIX}x`);
    assert.equal(a, b);
    assert.match(a, /^[a-f0-9]{64}$/);
  });
});

describe('redactComfyUpstreamForClient', () => {
  const prevEnabled = process.env.COMFY_PROXY_ENABLED;

  after(() => {
    if (prevEnabled === undefined) delete process.env.COMFY_PROXY_ENABLED;
    else process.env.COMFY_PROXY_ENABLED = prevEnabled;
  });

  it('passes through when proxy disabled', () => {
    process.env.COMFY_PROXY_ENABLED = '0';
    const input = {
      comfyUrl: 'https://abc.us.clorecloud.net',
      ip: 'abc.us.clorecloud.net',
      port: 443,
    };
    assert.deepEqual(redactComfyUpstreamForClient(input), input);
  });

  it('strips upstream and sets workReady when proxy enabled', () => {
    process.env.COMFY_PROXY_ENABLED = '1';
    const out = redactComfyUpstreamForClient({
      status: 'running',
      comfyUrl: 'https://abc.us.clorecloud.net',
      ip: 'abc.us.clorecloud.net',
      port: 443,
    });
    assert.equal(out.comfyUrl, null);
    assert.equal(out.ip, null);
    assert.equal(out.port, null);
    assert.equal(out.workReady, true);
    assert.equal(out.status, 'running');
  });
});